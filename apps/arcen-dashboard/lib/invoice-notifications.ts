import { db } from "@/lib/db";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { toPrismaJson } from "@/lib/prisma-json";

function readMetadata(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export async function sendPaidInvoiceReceipt(input: {
  teamId: string;
  invoiceId: string;
  txHash?: string | null;
}) {
  const invoice = await db.invoice.findFirst({
    where: {
      id: input.invoiceId,
      teamId: input.teamId,
      status: "PAID",
    },
    select: {
      id: true,
      number: true,
      teamId: true,
      customerEmail: true,
      total: true,
      currency: true,
      paidAt: true,
      metadata: true,
    },
  });

  if (!invoice?.customerEmail) {
    return { sent: false as const, reason: "missing_customer_email" };
  }

  const metadata = readMetadata(invoice.metadata);
  const receiptEmail = readMetadata(metadata.receiptEmail);
  const lastSentTxHash =
    typeof receiptEmail.txHash === "string" ? receiptEmail.txHash : null;
  if (input.txHash && lastSentTxHash === input.txHash) {
    return { sent: false as const, reason: "already_sent_for_payment" };
  }

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    invoice.teamId,
    invoice.id,
  );

  await sendPaymentReceiptEmail({
    to: invoice.customerEmail,
    invoiceNumber: invoice.number || invoice.id,
    total: String(invoice.total),
    currency: invoice.currency,
    paidAt: invoice.paidAt?.toISOString() ?? null,
    downloadUrl,
  });

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      metadata: toPrismaJson({
        ...metadata,
        receiptEmail: {
          sentAt: new Date().toISOString(),
          txHash: input.txHash ?? null,
        },
      }),
    },
  });

  return { sent: true as const };
}
