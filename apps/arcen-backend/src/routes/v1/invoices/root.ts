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
  const activeEnvironmentPlanIds = (
    await db.catalogPlan.findMany({
      where: {
        teamId: auth.team.teamId,
        environmentId: activeEnvironment.id,
      },
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
            ...(activeEnvironmentPlanIds.length > 0
              ? [
                  {
                    environmentId: null,
                    planId: { in: activeEnvironmentPlanIds },
                  },
                ]
              : []),
          ],
        },
      ],
    },
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" }, take: 3 },
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

  return c.json({ invoices });
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
