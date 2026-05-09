import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  decimalToAtomicUnits,
  normalizeTxHash,
  verifyDirectErc20Transfer,
} from "../../../lib/payments/onchain-payment-verification.js";
import { recordRefund } from "../../../lib/billing/billing-balances.js";

const createSchema = z.object({
  amount: z.coerce.number().positive(),
  reason: z.string().min(1).max(500),
  refundProof: z.object({
    txHash: z.string().min(1),
    recipientWallet: z
      .string()
      .regex(/^0x[0-9a-fA-F]{40}$/i)
      .optional(),
  }),
});

export async function GET(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  const refunds = await db.refund.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ refunds });
}

export async function POST(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: {
      payments: {
        where: { status: "SUCCEEDED" },
        orderBy: { settledAt: "desc" },
        take: 1,
      },
    },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  if (invoice.status !== "PAID") {
    return c.json({ error: "Only paid invoices can be refunded." }, 409 as any);
  }

  const normalizedTxHash = normalizeTxHash(parsed.data.refundProof.txHash);
  if (!normalizedTxHash) {
    return c.json({ error: "A valid on-chain refund transaction hash is required." }, 400 as any);
  }

  const owner = await db.teamMember.findFirst({
    where: { teamId: auth.team.teamId, role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = owner?.user?.walletAddress?.toLowerCase();
  if (!providerWallet) {
    return c.json({ error: "Provider wallet is not configured for this workspace." }, 409 as any);
  }

  const plan = invoice.planId
    ? await db.catalogPlan.findFirst({
        where: { id: invoice.planId, teamId: auth.team.teamId },
        select: { acceptedToken: true },
      })
    : null;

  if (!plan?.acceptedToken) {
    return c.json({
        error:
          "This invoice is not linked to a catalog plan with an accepted token, so the refund cannot be verified safely.",
      }, 409 as any);
  }

  const recipientWallet =
    parsed.data.refundProof.recipientWallet?.toLowerCase() ??
    invoice.customerWallet?.toLowerCase() ??
    null;
  if (!recipientWallet) {
    return c.json({ error: "A refund recipient wallet is required." }, 400 as any);
  }

  const verification = await verifyDirectErc20Transfer({
    acceptedToken: plan.acceptedToken,
    txHash: normalizedTxHash,
    expectedAmountAtomic: decimalToAtomicUnits(parsed.data.amount.toFixed(6)),
    recipientWallet,
    senderWallet: providerWallet,
  });
  if (!verification.ok) {
    return c.json(
      { error: verification.error },
      verification.status,
    );
  }

  const refund = await recordRefund({
    teamId: auth.team.teamId,
    walletAddress: recipientWallet,
    invoiceId: invoice.id,
    paymentId: invoice.payments[0]?.id ?? null,
    amount: parsed.data.amount,
    currency: invoice.currency,
    reason: parsed.data.reason,
    txHash: verification.txHash,
    occurredAt: new Date(),
    settledAt: new Date(),
    status: "SETTLED",
    metadata: {
      source: "invoice.refund",
      invoiceNumber: invoice.number,
      senderWallet: verification.senderWallet,
      recipientWallet: verification.recipientWallet,
    },
  });

  await writeAuditEvent({
    headers: { get: (name: string) => c.req.header(name) },
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "invoice.refund.create",
    resourceType: "Refund",
    resourceId: refund.id,
    afterData: {
      invoiceId: invoice.id,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
      txHash: verification.txHash,
    },
  });

  return c.json({ refund }, 201 as any);
}
