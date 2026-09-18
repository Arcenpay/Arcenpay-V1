import { db } from "../../db.js";
import { sendPaymentReceiptEmail } from "./email.js";
import {
  createInvoiceDownloadUrl,
  renderInvoicePdfBytes,
} from "./invoice-documents.js";
import {
  getPaymentMethodLabel,
  getProviderDisplayName,
  getStoredReceiptNumber,
  getSupportDetails,
  loadInvoiceBillingContext,
} from "./invoice-context.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

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
  const context = await loadInvoiceBillingContext(input.teamId, input.invoiceId);
  if (!context || context.invoice.status !== "PAID" || !context.invoice.customerEmail) {
    return { sent: false as const, reason: "missing_customer_email" };
  }

  const metadata = readMetadata(context.invoice.metadata);
  const receiptEmail = readMetadata(metadata.receiptEmail);
  const lastSentTxHash =
    typeof receiptEmail.txHash === "string" ? receiptEmail.txHash : null;
  if (input.txHash && lastSentTxHash === input.txHash) {
    return { sent: false as const, reason: "already_sent_for_payment" };
  }

  const [invoiceDoc, receiptDoc] = await Promise.all([
    renderInvoicePdfBytes({
      teamId: context.invoice.teamId,
      invoiceId: context.invoice.id,
      kind: "invoice",
    }),
    renderInvoicePdfBytes({
      teamId: context.invoice.teamId,
      invoiceId: context.invoice.id,
      kind: "receipt",
    }),
  ]);
  const receiptNumber =
    receiptDoc.receiptNumber ?? getStoredReceiptNumber(context);
  const providerName = getProviderDisplayName(context);
  const paymentMethod = getPaymentMethodLabel(context);
  const support = getSupportDetails(context);
  const amountPaid =
    Number(context.invoice.amountPaid) > 0
      ? String(context.invoice.amountPaid)
      : String(context.invoice.total);
  const invoiceDownloadUrl = createInvoiceDownloadUrl({
    invoiceId: context.invoice.id,
    kind: "invoice",
  });
  const receiptDownloadUrl = createInvoiceDownloadUrl({
    invoiceId: context.invoice.id,
    kind: "receipt",
  });

  try {
    const result = await sendPaymentReceiptEmail({
      to: context.invoice.customerEmail,
      invoiceNumber: context.invoice.number || context.invoice.id,
      receiptNumber: receiptNumber || getStoredReceiptNumber(context),
      total: amountPaid,
      currency: context.invoice.currency,
      paidAt: context.invoice.paidAt?.toISOString() ?? null,
      providerName,
      paymentMethod,
      supportEmail: support.email,
      supportPhone: support.phone,
      supportUrl: support.url,
      invoiceDownloadUrl,
      receiptDownloadUrl,
      subtotal: String(context.invoice.subtotal),
      taxTotal: String(context.invoice.taxTotal),
      amountPaid,
      lineItems: context.invoice.lineItems.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitAmount: String(line.unitAmount),
        total: String(line.lineTotal),
      })),
      invoicePdf: {
        filename: invoiceDoc.filename,
        contentBase64: invoiceDoc.bytes.toString("base64"),
      },
      receiptPdf: {
        filename: receiptDoc.filename,
        contentBase64: receiptDoc.bytes.toString("base64"),
      },
    });

    const delivery = await db.invoiceDelivery.create({
      data: {
        invoiceId: context.invoice.id,
        provider: "resend",
        method: "email",
        status: "SENT",
        attempts: 1,
        externalMessageId: result.id ?? null,
        sentAt: new Date(),
      },
    });

    await db.invoice.update({
      where: { id: context.invoice.id },
      data: {
        metadata: toPrismaJson({
          ...metadata,
          receiptEmail: {
            sentAt: new Date().toISOString(),
            txHash: input.txHash ?? null,
            receiptNumber,
            deliveryId: delivery.id,
          },
        }),
      },
    });

    return { sent: true as const };
  } catch (error) {
    await db.invoiceDelivery.create({
      data: {
        invoiceId: context.invoice.id,
        provider: "resend",
        method: "email",
        status: "FAILED",
        attempts: 1,
        errorMessage: error instanceof Error ? error.message : "send failed",
      },
    });

    return {
      sent: false as const,
      reason: error instanceof Error ? error.message : "send_failed",
    };
  }
}
