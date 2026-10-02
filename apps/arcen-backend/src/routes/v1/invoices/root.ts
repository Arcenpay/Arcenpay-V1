import type { Context } from "hono";
import { z } from "zod";
import {
  isValidAnyFamilyTxHash,
  normalizeAnyFamilyTxHash,
} from "@arcenpay/internal-core";
import { db } from "../../../db.js";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { allocateInvoiceNumber, toSix } from "../../../lib/billing/invoices.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { ensureInvoicePdfForTeam } from "../../../lib/billing/invoice-documents.js";
import { sendInvoiceEmail } from "../../../lib/billing/email.js";
import { billingAddressSchema } from "../../../lib/billing/invoice-tax.js";
import { deliverWebhook } from "../../../lib/webhooks/deliver-webhook.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import { WALLET_ADDRESS_REGEX } from "../../../lib/platform/chain-family.js";

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
  // Family-agnostic: an EVM hex hash OR a Solana base58 signature. Solana
  // signatures must not be lowercased (that corrupts them).
  const paymentTxHash = invoice.payments?.[0]?.txHash;
  if (paymentTxHash && isValidAnyFamilyTxHash(paymentTxHash)) {
    return normalizeAnyFamilyTxHash(paymentTxHash);
  }
  const metadataTxHash = asRecord(invoice.metadata).txHash;
  return typeof metadataTxHash === "string" &&
    isValidAnyFamilyTxHash(metadataTxHash)
    ? normalizeAnyFamilyTxHash(metadataTxHash)
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
    .regex(WALLET_ADDRESS_REGEX)
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
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:read", apiPermission: "read" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = listSchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  // Sessions resolve the active workspace environment; API keys are already
  // scoped to the environment they were created in. API keys MUST be
  // environment-bound — a key without an environment cannot safely scope a
  // query and is rejected (matches the create route).
  if (auth.source === "api_key" && !auth.environmentId) {
    return c.json(
      { error: "This key is not bound to a workspace environment. Recreate it bound to an environment." },
      409 as any,
    );
  }

  let activeEnvironmentId: string | null = auth.environmentId ?? null;
  if (auth.source === "session" && auth.session) {
    const activeEnvironment = await requireResolvedActiveEnvironment(
      auth.session.session,
      auth.teamId,
    );
    if (!activeEnvironment) {
      return c.json({ error: "No workspace environment selected" }, 409 as any);
    }
    activeEnvironmentId = activeEnvironment.id;
  }

  if (!activeEnvironmentId) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const where = {
    teamId: auth.teamId,
    environmentId: activeEnvironmentId,
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

  const invoices = await db.invoice.findMany({
    where,
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
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:write", apiPermission: "write" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  // Sessions resolve the active workspace environment. API keys are bound to
  // the environment they were created in and require one to create invoices —
  // a key without an environment cannot scope the invoice.
  let activeEnvironment: { id: string; mode: "DEVELOPMENT" | "PRODUCTION" } | null = null;
  if (auth.source === "session" && auth.session) {
    const env = await requireResolvedActiveEnvironment(
      auth.session.session,
      auth.teamId,
    );
    if (!env) {
      return c.json({ error: "No workspace environment selected" }, 409 as any);
    }
    activeEnvironment = env;
  } else if (auth.environmentId) {
    const env = await db.workspaceEnvironment.findFirst({
      where: { id: auth.environmentId, teamId: auth.teamId },
      select: { id: true, mode: true },
    });
    if (env) activeEnvironment = { id: env.id, mode: env.mode };
  }

  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected for this key. Recreate the key bound to a workspace environment." }, 409 as any);
  }

  const team = await db.team.findUnique({
    where: { id: auth.teamId },
    select: { slug: true, invoicePrefix: true },
  });

  if (!team) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
  const number = await allocateInvoiceNumber(auth.teamId, prefix);

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
      teamId: auth.teamId,
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
    auth.teamId,
    invoice.id,
  );

  deliverWebhook(auth.teamId, "invoice.issued", {
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
      deliverWebhook(auth.teamId, "invoice.delivery_failed", {
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
    teamId: auth.teamId,
    userId: auth.userId ?? undefined,
    walletAddress: auth.walletAddress ?? undefined,
    action: "invoice.create",
    resourceType: "Invoice",
    resourceId: invoice.id,
    afterData: invoice,
  });

  return c.json({ invoice, downloadUrl }, 201 as any);
}
