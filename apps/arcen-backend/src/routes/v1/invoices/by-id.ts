import type { Context } from "hono";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { ensureInvoicePdfForTeam } from "../../../lib/billing/invoice-documents.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { deliverWebhook } from "../../../lib/webhooks/deliver-webhook.js";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import { recordSuccessfulPayment } from "../../../lib/billing/billing-ledger.js";
import { sendPaidInvoiceReceipt } from "../../../lib/billing/invoice-notifications.js";
import {
  decimalToAtomicUnits,
  normalizeTxHash,
  verifyDirectErc20Transfer,
} from "../../../lib/payments/onchain-payment-verification.js";

export async function GET(c: Context) {
  const auth = await requirePermission(c, "invoices:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
    include: {
      lineItems: true,
      deliveries: { orderBy: { createdAt: "desc" } },
      creditNotes: { orderBy: { createdAt: "desc" } },
      refunds: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    auth.team.teamId,
    invoice.id,
  );

  return c.json({ invoice, downloadUrl });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID", "OVERDUE"],
  OVERDUE: ["PAID", "VOID"],
};

import { z } from "zod";

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

export async function PATCH(c: Context) {
  const auth = await requirePermission(c, "invoices:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const body = await c.req.json() .catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const invoice = await db.invoice.findFirst({
    where: { id, teamId: auth.team.teamId },
  });

  if (!invoice) {
    return c.json({ error: "Invoice not found" }, 404 as any);
  }

  const allowed = ALLOWED_TRANSITIONS[invoice.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return c.json({
        error: `Cannot transition invoice from ${invoice.status} to ${parsed.data.status}`,
        allowed,
      }, 409 as any);
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
      return c.json({
          error:
            "A verified on-chain payment proof is required before an invoice can be marked PAID.",
        }, 400 as any);
    }

    const owner = await db.teamMember.findFirst({
      where: { teamId: auth.team.teamId, role: "OWNER" },
      select: { user: { select: { walletAddress: true } } },
    });
    const providerWallet = owner?.user?.walletAddress?.toLowerCase();
    if (!providerWallet) {
      return c.json({
          error:
            "Provider wallet is not configured for this workspace. Link the owner wallet before marking invoices paid.",
        }, 409 as any);
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
            "This invoice is not linked to a catalog plan with an accepted token, so the payment cannot be verified safely.",
        }, 409 as any);
    }

    const payerWallet =
      parsed.data.paymentProof?.payerWallet?.toLowerCase() ??
      invoice.customerWallet?.toLowerCase() ??
      null;
    if (!payerWallet) {
      return c.json({
          error:
            "A payer wallet is required to verify this payment proof. Provide paymentProof.payerWallet or store customerWallet on the invoice.",
        }, 400 as any);
    }

    const verification = await verifyDirectErc20Transfer({
      acceptedToken: plan.acceptedToken,
      txHash: normalizedTxHash,
      expectedAmountAtomic: decimalToAtomicUnits(String(invoice.total)),
      recipientWallet: providerWallet,
      senderWallet: payerWallet,
    });

    if (!verification.ok) {
      return c.json({ error: verification.error }, verification.status as any);
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
    headers: { get: (name: string) => c.req.header(name) },
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
    await sendPaidInvoiceReceipt({
      teamId: auth.team.teamId,
      invoiceId: updated.id,
      txHash: verifiedPaymentProof?.txHash ?? null,
    }).catch(() => {});

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

  return c.json({ invoice: updated });
}
