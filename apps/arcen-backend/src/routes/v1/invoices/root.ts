import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { allocateInvoiceNumber, toSix } from "../../../lib/billing/invoices.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { ensureInvoicePdfForTeam } from "../../../lib/billing/invoice-documents.js";
import { sendInvoiceEmail } from "../../../lib/billing/email.js";
import { billingAddressSchema } from "../../../lib/billing/invoice-tax.js";
import { deliverWebhook } from "../../../lib/webhooks/deliver-webhook.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const listSchema = z.object({
  status: z.enum(["DRAFT", "ISSUED", "PAID", "VOID", "OVERDUE"]).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  q: z.string().optional(),
});

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readInvoiceTxHash(invoice: {
  metadata: unknown;
  payments?: Array<{ txHash: string | null }>;
}): string | null {
  const paymentTxHash = invoice.payments?.[0]?.txHash;
  if (paymentTxHash && /^0x[0-9a-fA-F]{64}$/.test(paymentTxHash)) {
    return paymentTxHash.toLowerCase();
  }
  const metadataTxHash = asRecord(invoice.metadata).txHash;
  return typeof metadataTxHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(metadataTxHash)
    ? metadataTxHash.toLowerCase()
    : null;
}

function readSubscriptionActivationInvoiceKey(invoice: {
  companyId?: string | null;
  customerWallet?: string | null;
  customerEmail?: string | null;
  planId?: string | null;
  total?: unknown;
  currency?: string | null;
  issuedAt?: Date | string | null;
  metadata: unknown;
}): string | null {
  const metadata = asRecord(invoice.metadata);
  const mode = typeof metadata.mode === "string" ? metadata.mode : null;
  const canonicalEventName =
    typeof metadata.canonicalEventName === "string"
      ? metadata.canonicalEventName
      : null;
  const isSubscriptionActivation =
    mode === "subscription_activation" ||
    canonicalEventName === "subscription.minted";

  if (!isSubscriptionActivation || !invoice.planId) return null;

  const tokenId =
    typeof metadata.tokenId === "string" || typeof metadata.tokenId === "number"
      ? String(metadata.tokenId)
      : null;
  const onChainPlanId =
    typeof metadata.onChainPlanId === "string" ||
    typeof metadata.onChainPlanId === "number"
      ? String(metadata.onChainPlanId)
      : null;
  if (tokenId && onChainPlanId) {
    return `activation:${tokenId}:${onChainPlanId}`;
  }

  const issuedAt =
    invoice.issuedAt instanceof Date
      ? invoice.issuedAt
      : invoice.issuedAt
        ? new Date(invoice.issuedAt)
        : null;
  const issuedDay =
    issuedAt && !Number.isNaN(issuedAt.getTime())
      ? issuedAt.toISOString().slice(0, 10)
      : "unknown-day";
  const customerKey =
    invoice.companyId ??
    invoice.customerWallet?.toLowerCase() ??
    invoice.customerEmail?.toLowerCase() ??
    "unknown-customer";

  return [
    "subscription-activation",
    customerKey,
    invoice.planId,
    String(invoice.total ?? "0"),
    invoice.currency ?? "USDC",
    issuedDay,
  ].join(":");
}

function scoreInvoiceForDisplay(invoice: {
  customerEmail?: string | null;
  customerWallet?: string | null;
  metadata: unknown;
  payments?: Array<{ txHash: string | null }>;
  deliveries?: Array<{ status: string }>;
}): number {
  const metadata = asRecord(invoice.metadata);
  return (
    (readInvoiceTxHash(invoice) ? 16 : 0) +
    (invoice.customerEmail ? 8 : 0) +
    (invoice.customerWallet ? 4 : 0) +
    (typeof metadata.customerName === "string" && metadata.customerName.trim()
      ? 2
      : 0) +
    (invoice.deliveries?.some((delivery) => delivery.status === "SENT")
      ? 1
      : 0)
  );
}

const createSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
  customerEmail: z.string().email().optional(),
  customerName: z.string().trim().min(1).optional(),
  customerWallet: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  currency: z.string().default("USDC"),
  dueAt: z.string().datetime().optional(),
  planId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  billingAddress: billingAddressSchema.optional(),
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.coerce.number().int().positive().default(1),
        unitAmount: z.coerce.number().nonnegative(),
        taxRate: z.coerce.number().min(0).max(100).default(0),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .min(1),
});

export async function GET(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = listSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const where = {
    teamId: auth.team.teamId,
    ...(parsed.data.status && { status: parsed.data.status }),
    ...(parsed.data.q && {
      OR: [
        { number: { contains: parsed.data.q, mode: "insensitive" as const } },
        {
          customerEmail: {
            contains: parsed.data.q,
            mode: "insensitive" as const,
          },
        },
        {
          customerWallet: {
            contains: parsed.data.q,
            mode: "insensitive" as const,
          },
        },
      ],
    }),
  };
  // Broader plan lookup: all plans in the team (cross-environment safety net)
  const allTeamPlanIds = (
    await db.catalogPlan.findMany({
      where: { teamId: auth.team.teamId },
      select: { id: true },
    })
  ).map((plan) => plan.id);

  const invoices = await db.invoice.findMany({
    where: {
      ...where,
      AND: [
        {
          OR: [
            { environmentId: activeEnvironment.id },
            { environmentId: null },
            ...(allTeamPlanIds.length > 0
              ? [{ planId: { in: allTeamPlanIds } }]
              : []),
          ],
        },
      ],
    },
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 3 },
      payments: {
        where: { txHash: { not: null } },
        select: { txHash: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      company: {
        select: {
          name: true,
          email: true,
          walletAddress: true,
        },
      },
      paymentLinks: {
        select: {
          id: true,
          kind: true,
          name: true,
          slug: true,
        },
        orderBy: { createdAt: "desc" },
        take: 3,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 100,
  });

  const groupedInvoices = new Map<string, (typeof invoices)[number]>();
  for (const invoice of invoices) {
    const txHash = readInvoiceTxHash(invoice);
    const invoiceKey = txHash
      ? `tx:${txHash}`
      : (readSubscriptionActivationInvoiceKey(invoice) ??
        `invoice:${invoice.id}`);
    const existing = groupedInvoices.get(invoiceKey);
    if (
      !existing ||
      scoreInvoiceForDisplay(invoice) > scoreInvoiceForDisplay(existing)
    ) {
      groupedInvoices.set(invoiceKey, invoice);
    }
  }

  const dedupedInvoices = Array.from(groupedInvoices.values()).map((invoice) => {
    const metadata = asRecord(invoice.metadata);
    const customerName =
      typeof metadata.customerName === "string" && metadata.customerName.trim()
        ? metadata.customerName.trim()
        : invoice.company?.name?.trim() || null;

    return {
      ...invoice,
      customerEmail: invoice.customerEmail ?? invoice.company?.email ?? null,
      customerWallet:
        invoice.customerWallet ?? invoice.company?.walletAddress ?? null,
      metadata: {
        ...metadata,
        ...(customerName ? { customerName } : {}),
      },
    };
  });

  return c.json({ invoices: dedupedInvoices });
}

export async function POST(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { slug: true, invoicePrefix: true },
  });

  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
  const number = await allocateInvoiceNumber(auth.team.teamId, prefix);

  const lines = parsed.data.lines.map((line) => {
    const lineSubtotal = line.quantity * line.unitAmount;
    const lineTax = lineSubtotal * (line.taxRate / 100);
    const lineTotal = lineSubtotal + lineTax;
    return {
      description: line.description,
      quantity: line.quantity,
      unitAmount: toSix(line.unitAmount),
      taxRate: line.taxRate.toFixed(4),
      lineSubtotal: toSix(lineSubtotal),
      lineTax: toSix(lineTax),
      lineTotal: toSix(lineTotal),
      metadata: toPrismaNullableJson(line.metadata),
    };
  });

  const subtotal = lines.reduce(
    (acc, line) => acc + Number(line.lineSubtotal),
    0,
  );
  const taxTotal = lines.reduce((acc, line) => acc + Number(line.lineTax), 0);
  const total = subtotal + taxTotal;

  const invoice = await db.invoice.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
      status: "ISSUED",
      number,
      currency: parsed.data.currency,
      customerEmail: parsed.data.customerEmail,
      customerWallet: parsed.data.customerWallet,
      subtotal: toSix(subtotal),
      taxTotal: toSix(taxTotal),
      total: toSix(total),
      amountPaid: toSix(0),
      amountCredited: toSix(0),
      amountOutstanding: toSix(total),
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : undefined,
      issuedAt: new Date(),
      planId: parsed.data.planId,
      metadata: toPrismaNullableJson({
        ...parsed.data.metadata,
        ...(parsed.data.customerName && { customerName: parsed.data.customerName }),
        ...(parsed.data.billingAddress && { billingAddress: parsed.data.billingAddress }),
      }),
      lineItems: {
        createMany: { data: lines },
      },
      deliveries: {
        create: {
          provider: "resend",
          method: "email",
          status: "PENDING",
        },
      },
    },
    include: { lineItems: true, deliveries: true },
  });

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    auth.team.teamId,
    invoice.id,
  );

  deliverWebhook(auth.team.teamId, "invoice.issued", {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerEmail: invoice.customerEmail,
    customerWallet: invoice.customerWallet,
    total: String(invoice.total),
    currency: invoice.currency,
    status: invoice.status,
    planId: invoice.planId,
  }).catch(() => {});

  const pendingDelivery = invoice.deliveries[0];
  if (parsed.data.customerEmail && pendingDelivery) {
    try {
      await sendInvoiceEmail({
        to: parsed.data.customerEmail,
        invoiceNumber: invoice.number || invoice.id,
        total: String(invoice.total),
        currency: invoice.currency,
        dueDate: invoice.dueAt ? invoice.dueAt.toISOString() : undefined,
        downloadUrl,
      });
      await db.invoiceDelivery.update({
        where: { id: pendingDelivery.id },
        data: { status: "SENT", sentAt: new Date(), attempts: 1 },
      });
    } catch (err: any) {
      await db.invoiceDelivery.update({
        where: { id: pendingDelivery.id },
        data: {
          status: "FAILED",
          attempts: 1,
          errorMessage: err?.message || "send failed",
        },
      });
      deliverWebhook(auth.team.teamId, "invoice.delivery_failed", {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerEmail: invoice.customerEmail,
        customerWallet: invoice.customerWallet,
        error: err?.message || "send failed",
      }).catch(() => {});
    }
  }

  await writeAuditEvent({
    headers: { get: (name: string) => c.req.header(name) },
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "invoice.create",
    resourceType: "Invoice",
    resourceId: invoice.id,
    afterData: invoice,
  });

  return c.json({ invoice, downloadUrl }, 201 as any);
}
