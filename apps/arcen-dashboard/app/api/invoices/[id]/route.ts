import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { writeAuditEvent } from "@/lib/audit";
import { deliverWebhook } from "@/lib/deliver-webhook";
import { toPrismaJson } from "@/lib/prisma-json";
import { recordSuccessfulPayment } from "@/lib/billing-ledger";
import {
  decimalToAtomicUnits,
  normalizeTxHash,
  verifyDirectErc20Transfer,
} from "@/lib/onchain-payment-verification";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:read");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" } },
      creditNotes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    auth.team.teamId,
    invoice.id,
  );

  return NextResponse.json({ invoice, downloadUrl });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID", "OVERDUE"],
  OVERDUE: ["PAID", "VOID"],
};

const patchSchema = z.object({
  status: z.enum(["ISSUED", "PAID", "VOID", "OVERDUE"]),
  note: z.string().max(500).optional(),
  paymentProof: z
    .object({
      txHash: z.string().min(1),
      payerWallet: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/i)
        .optional(),
    })
    .optional(),
});

export async function PATCH(request: NextRequest, context: Params) {
  const auth = await requirePermission("invoices:write");
  if (isErrorResponse(auth)) return auth;

  const { id } = await context.params;

  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
  });

  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return NextResponse.json(
      {
        error: `Cannot transition invoice from ${invoice.status} to ${parsed.data.status}`,
        allowed,
      },
      { status: 409 },
    );
  }

  let verifiedPaymentProof:
    | {
        txHash: `0x${string}`;
        payerWallet: string;
        recipientWallet: string;
      }
    | null = null;

  if (parsed.data.status === "PAID") {
    const normalizedTxHash = normalizeTxHash(parsed.data.paymentProof?.txHash);
    if (!normalizedTxHash) {
      return NextResponse.json(
        {
          error:
            "A verified on-chain payment proof is required before an invoice can be marked PAID.",
        },
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
        {
          error:
            "Provider wallet is not configured for this workspace. Link the owner wallet before marking invoices paid.",
        },
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
            "This invoice is not linked to a catalog plan with an accepted token, so the payment cannot be verified safely.",
        },
        { status: 409 },
      );
    }

    const payerWallet =
      parsed.data.paymentProof?.payerWallet?.toLowerCase() ??
      invoice.customerWallet?.toLowerCase() ??
      null;
    if (!payerWallet) {
      return NextResponse.json(
        {
          error:
            "A payer wallet is required to verify this payment proof. Provide paymentProof.payerWallet or store customerWallet on the invoice.",
        },
        { status: 400 },
      );
    }

    const verification = await verifyDirectErc20Transfer({
      acceptedToken: plan.acceptedToken,
      txHash: normalizedTxHash,
      expectedAmountAtomic: decimalToAtomicUnits(String(invoice.total)),
      recipientWallet: providerWallet,
      senderWallet: payerWallet,
    });

    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }

    verifiedPaymentProof = {
      txHash: verification.txHash,
      payerWallet: verification.senderWallet,
      recipientWallet: verification.recipientWallet,
    };
  }

  const updated = await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: parsed.data.status,
      ...(parsed.data.status === "PAID" && { paidAt: new Date() }),
      ...(verifiedPaymentProof
        ? {
            metadata: toPrismaJson({
              ...(invoice.metadata &&
              typeof invoice.metadata === "object" &&
              !Array.isArray(invoice.metadata)
                ? (invoice.metadata as Record<string, unknown>)
                : {}),
              paymentProof: {
                ...verifiedPaymentProof,
                verifiedAt: new Date().toISOString(),
              },
            }),
          }
        : {}),
    },
  });

  if (verifiedPaymentProof) {
    await recordSuccessfulPayment({
      idempotencyKey: `payment:invoice.paid:${invoice.id}:${verifiedPaymentProof.txHash}`,
      teamId: auth.team.teamId,
      walletAddress: invoice.customerWallet,
      invoiceId: invoice.id,
      kind: "MANUAL_INVOICE_PAYMENT",
      amount: Number(invoice.total),
      currency: invoice.currency,
      payerWallet: verifiedPaymentProof.payerWallet,
      recipientWallet: verifiedPaymentProof.recipientWallet,
      txHash: verifiedPaymentProof.txHash,
      occurredAt: updated.paidAt ?? new Date(),
      settledAt: updated.paidAt ?? new Date(),
      metadata: {
        source: "invoice.patch",
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
      },
    });
  }

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: `invoice.status.${parsed.data.status.toLowerCase()}`,
    resourceType: "Invoice",
    resourceId: invoice.id,
    beforeData: { status: invoice.status },
    afterData: {
      status: updated.status,
      note: parsed.data.note,
      ...(verifiedPaymentProof ? { paymentProof: verifiedPaymentProof } : {}),
    },
  });

  if (parsed.data.status === "PAID") {
    deliverWebhook(auth.team.teamId, "invoice.paid", {
      invoiceId: updated.id,
      invoiceNumber: updated.number,
      customerEmail: updated.customerEmail,
      customerWallet: updated.customerWallet,
      total: String(updated.total),
      currency: updated.currency,
      paidAt: updated.paidAt?.toISOString() ?? null,
    }).catch(() => {});
  }

  return NextResponse.json({ invoice: updated });
}
