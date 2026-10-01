import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requireInvoiceAuth, isInvoiceAuthError } from "../../../lib/auth/invoice-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { WALLET_ADDRESS_REGEX } from "../../../lib/platform/chain-family.js";
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
      .regex(WALLET_ADDRESS_REGEX)
      .optional(),
  }),
});

export async function GET(c: Context) {
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:read", apiPermission: "read" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.teamId },
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
  const auth = await requireInvoiceAuth(c, { rolePermission: "invoices:write", apiPermission: "write" });
  if (isInvoiceAuthError(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.teamId },
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
    where: { teamId: auth.teamId, role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = owner?.user?.walletAddress?.toLowerCase();
  if (!providerWallet) {
    return c.json({ error: "Provider wallet is not configured for this workspace." }, 409 as any);
  }

  const plan = invoice.planId
    ? await db.catalogPlan.findFirst({
        where: { id: invoice.planId, teamId: auth.teamId },
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
      verification.status as any,
    );
  }

  const refund = await recordRefund({
    teamId: auth.teamId,
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
    teamId: auth.teamId,
    userId: auth.userId ?? undefined,
    walletAddress: auth.walletAddress ?? undefined,
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
