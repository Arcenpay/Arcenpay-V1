import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  decimalToAtomicUnits,
  normalizeTxHash,
  verifyDirectErc20Transfer,
} from "@/lib/onchain-payment-verification";
import { recordRefund } from "@/lib/billing-balances";

type Params = { params: Promise<{ id: string }> };

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

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    select: { id: true },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const refunds = await db.refund.findMany({
    where: { invoiceId: invoice.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ refunds });
}

export async function POST(request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
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
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  if (invoice.status !== "PAID") {
    return NextResponse.json(
      { error: "Only paid invoices can be refunded." },
      { status: 409 },
    );
  }

  const normalizedTxHash = normalizeTxHash(parsed.data.refundProof.txHash);
  if (!normalizedTxHash) {
    return NextResponse.json(
      { error: "A valid on-chain refund transaction hash is required." },
      { status: 400 },
    );
  }

  const owner = await db.teamMember.findFirst({
    where: { teamId: auth.team.teamId, role: "OWNER" },
    select: { user: { select: { walletAddress: true } } },
  });
  const providerWallet = owner?.user?.walletAddress?.toLowerCase();
  if (!providerWallet) {
    return NextResponse.json(
      { error: "Provider wallet is not configured for this workspace." },
      { status: 409 },
    );
  }

  const plan = invoice.planId
    ? await db.catalogPlan.findFirst({
        where: { id: invoice.planId, teamId: auth.team.teamId },
        select: { acceptedToken: true },
      })
    : null;

  if (!plan?.acceptedToken) {
    return NextResponse.json(
      {
        error:
          "This invoice is not linked to a catalog plan with an accepted token, so the refund cannot be verified safely.",
      },
      { status: 409 },
    );
  }

  const recipientWallet =
    parsed.data.refundProof.recipientWallet?.toLowerCase() ??
    invoice.customerWallet?.toLowerCase() ??
    null;
  if (!recipientWallet) {
    return NextResponse.json(
      { error: "A refund recipient wallet is required." },
      { status: 400 },
    );
  }

  const verification = await verifyDirectErc20Transfer({
    acceptedToken: plan.acceptedToken,
    txHash: normalizedTxHash,
    expectedAmountAtomic: decimalToAtomicUnits(parsed.data.amount.toFixed(6)),
    recipientWallet,
    senderWallet: providerWallet,
  });
  if (!verification.ok) {
    return NextResponse.json(
      { error: verification.error },
      { status: verification.status },
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
    request,
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

  return NextResponse.json({ refund }, { status: 201 });
}
