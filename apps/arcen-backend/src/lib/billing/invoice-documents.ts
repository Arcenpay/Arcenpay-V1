import { createHmac, timingSafeEqual } from "crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "../../db.js";
import {
  APP_URL,
  INVOICE_DOWNLOAD_SIGNING_SECRET,
  INVOICE_DOWNLOAD_URL_TTL_SECONDS,
} from "../../config.js";
import {
  getCustomerAddressLines,
  getPaymentMethodLabel,
  getProviderAddressLines,
  getProviderDisplayName,
  getStoredReceiptNumber,
  getSupportDetails,
  loadInvoiceBillingContext,
  readReceiptObjectKey,
  type LoadedInvoiceContext,
} from "./invoice-context.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { getStorage } from "../storage/index.js";
import { wrapColumnText } from "./utils.js";
import { renderTemplateInvoicePdf } from "./invoice-builder/renderer.js";
import {
  resolveTemplateConfigForTeam,
  stampInvoiceTemplateSnapshot,
} from "./invoice-builder/template-store.js";

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function formatMoney(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function formatDateLong(value: Date | string | null | undefined): string {
  if (!value) return "N/A";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function base64Url(value: Buffer): string {
  return value.toString("base64url");
}

function signPayload(payload: string): string {
  return base64Url(createHmac("sha256", INVOICE_DOWNLOAD_SIGNING_SECRET).update(payload).digest());
}

type InvoiceDocumentKind = "invoice" | "receipt";

function makeSignedPayload(invoiceId: string, kind: string, exp: number): string {
  return `${invoiceId}.${kind}.${exp}`;
}

/**
 * Stripe-style signed render URL. The PDF itself is never stored — each
 * request renders the live invoice object (snapshot-aware) on demand.
 */
export function createInvoiceDownloadUrl(input: {
  invoiceId: string;
  kind: InvoiceDocumentKind;
  expiresInSeconds?: number;
}): string {
  const exp =
    Math.floor(Date.now() / 1000) +
    (input.expiresInSeconds ?? INVOICE_DOWNLOAD_URL_TTL_SECONDS);
  const payload = makeSignedPayload(input.invoiceId, input.kind, exp);
  const sig = signPayload(payload);
  return `${APP_URL}/api/invoices/public/${encodeURIComponent(
    input.invoiceId,
  )}/download?kind=${input.kind}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

export function verifyInvoiceDownloadToken(input: {
  invoiceId: string;
  kind: string;
  expRaw: string;
  signature: string;
}): boolean {
  if (input.kind !== "invoice" && input.kind !== "receipt") return false;
  const exp = Number(input.expRaw);
  if (!Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = makeSignedPayload(input.invoiceId, input.kind, exp);
  const expected = signPayload(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
export async function readObject(objectKey: string): Promise<Buffer | null> {
  return getStorage().get(objectKey).catch(() => null);
}

type BillingDocumentKind = "invoice" | "receipt";

function drawText(
  page: any,
  text: string,
  options: {
    x: number;
    y: number;
    size?: number;
    bold?: boolean;
    color?: [number, number, number];
    font: any;
    boldFont: any;
  },
) {
  page.drawText(text, {
    x: options.x,
    y: options.y,
    size: options.size ?? 11,
    font: options.bold ? options.boldFont : options.font,
    color: rgb(...(options.color ?? [0.09, 0.11, 0.14])),
  });
}

function renderWrappedLines(
  text: string,
  maxLength = 54,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

export async function renderLegacyBillingDocumentPdf(input: {
  kind: BillingDocumentKind;
  context: NonNullable<LoadedInvoiceContext>;
  receiptNumber?: string | null;
}): Promise<Uint8Array> {
  const { context } = input;
  const invoice = context.invoice;
  const providerName = getProviderDisplayName(context);
  const providerLines = getProviderAddressLines(context);
  const customerLines = getCustomerAddressLines(context);
  const support = getSupportDetails(context);
  const paymentMethodLabel = getPaymentMethodLabel(context);
  const amountPaidValue =
    Number(invoice.amountPaid) > 0 ? String(invoice.amountPaid) : String(invoice.total);
  const amountDueValue =
    Number(invoice.amountOutstanding) > 0
      ? String(invoice.amountOutstanding)
      : String(invoice.total);
  const doc = await PDFDocument.create();
  // Pin PDF metadata dates to the invoice issue date so regenerating the same
  // invoice produces byte-identical output (idempotent document generation).
  const docDate = invoice.issuedAt ?? new Date(0);
  doc.setCreationDate(docDate);
  doc.setModificationDate(docDate);
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawRectangle({
    x: 40,
    y: 40,
    width: 515,
    height: 762,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.9, 0.92, 0.95),
    borderWidth: 1,
  });

  drawText(page, input.kind === "invoice" ? "Invoice" : "Receipt", {
    x: 58,
    y: 742,
    size: 28,
    bold: true,
    font,
    boldFont,
  });
  drawText(page, providerName, {
    x: 58,
    y: 714,
    size: 12,
    color: [0.35, 0.39, 0.45],
    font,
    boldFont,
  });

  let topMetaY = 675;
  const topMeta = input.kind === "invoice"
    ? [
        ["Invoice number", invoice.number || invoice.id],
        ["Date of issue", formatDateLong(invoice.issuedAt || invoice.createdAt)],
        ["Date due", formatDateLong(invoice.dueAt || invoice.issuedAt || invoice.createdAt)],
      ]
    : [
        ["Invoice number", invoice.number || invoice.id],
        ["Receipt number", input.receiptNumber || "N/A"],
        ["Date paid", formatDateLong(invoice.paidAt || invoice.updatedAt)],
      ];

  for (const [label, value] of topMeta) {
    drawText(page, label, {
      x: 58,
      y: topMetaY,
      size: 10,
      color: [0.35, 0.39, 0.45],
      font,
      boldFont,
    });
    drawText(page, value, {
      x: 175,
      y: topMetaY,
      size: 11,
      bold: true,
      font,
      boldFont,
    });
    topMetaY -= 24;
  }

  drawText(page, "From", {
    x: 58,
    y: 588,
    size: 11,
    bold: true,
    font,
    boldFont,
  });
  drawText(page, "Bill to", {
    x: 338,
    y: 588,
    size: 11,
    bold: true,
    font,
    boldFont,
  });

  let providerY = 560;
  for (const line of providerLines) {
    for (const chunk of wrapColumnText(line, 46)) {
      drawText(page, chunk, {
        x: 58,
        y: providerY,
        size: 11,
        font,
        boldFont,
      });
      providerY -= 22;
    }
  }

  let customerY = 560;
  for (const line of customerLines) {
    // Bill-to column is narrower (x=338 → page edge): wrap at 34 chars and
    // split long wallet addresses so they never overflow in portrait.
    for (const chunk of wrapColumnText(line, 34)) {
      drawText(page, chunk, {
        x: 338,
        y: customerY,
        size: 11,
        font,
        boldFont,
      });
      customerY -= 22;
    }
  }

  const amountHeadline =
    input.kind === "invoice"
      ? `${formatMoney(String(invoice.total))} ${invoice.currency} due ${formatDateLong(
          invoice.dueAt || invoice.issuedAt || invoice.createdAt,
        )}`
      : `${formatMoney(amountPaidValue)} ${invoice.currency} paid on ${formatDateLong(
          invoice.paidAt || invoice.updatedAt,
        )}`;

  drawText(page, amountHeadline, {
    x: 58,
    y: 445,
    size: 22,
    bold: true,
    font,
    boldFont,
  });

  page.drawLine({
    start: { x: 58, y: 398 },
    end: { x: 535, y: 398 },
    thickness: 1,
    color: rgb(0.84, 0.87, 0.91),
  });

  const headers = ["Description", "Qty", "Unit price", "Amount"];
  const headerXs = [58, 398, 455, 522];
  headers.forEach((header, index) => {
    drawText(page, header, {
      x: headerXs[index],
      y: 412,
      size: 10,
      color: [0.35, 0.39, 0.45],
      bold: index > 0,
      font,
      boldFont,
    });
  });

  let lineY = 372;
  for (const line of invoice.lineItems) {
    const descriptionLines = renderWrappedLines(line.description, 42);
    descriptionLines.forEach((chunk, chunkIndex) => {
      drawText(page, chunk, {
        x: 58,
        y: lineY - chunkIndex * 16,
        size: 11,
        bold: chunkIndex === 0,
        font,
        boldFont,
      });
    });
    drawText(page, String(line.quantity), {
      x: 404,
      y: lineY,
      size: 11,
      font,
      boldFont,
    });
    drawText(page, formatMoney(String(line.unitAmount)), {
      x: 445,
      y: lineY,
      size: 11,
      font,
      boldFont,
    });
    drawText(page, formatMoney(String(line.lineTotal)), {
      x: 505,
      y: lineY,
      size: 11,
      font,
      boldFont,
    });
    lineY -= Math.max(28, descriptionLines.length * 16 + 10);
  }

  const totalsXLabel = 350;
  const totalsXValue = 505;
  const totals: Array<[string, string, boolean]> = [
    ["Subtotal", `${formatMoney(String(invoice.subtotal))} ${invoice.currency}`, false],
  ];

  if (Number(invoice.taxTotal) > 0) {
    totals.push(["Tax", `${formatMoney(String(invoice.taxTotal))} ${invoice.currency}`, false]);
  }
  totals.push(["Total", `${formatMoney(String(invoice.total))} ${invoice.currency}`, true]);
  if (input.kind === "receipt") {
    totals.push([
      "Amount paid",
      `${formatMoney(amountPaidValue)} ${invoice.currency}`,
      true,
    ]);
  } else {
    totals.push([
      "Amount due",
      `${formatMoney(amountDueValue)} ${invoice.currency}`,
      true,
    ]);
  }

  let totalsY = Math.max(180, lineY - 20);
  for (const [label, value, bold] of totals) {
    page.drawLine({
      start: { x: totalsXLabel, y: totalsY + 18 },
      end: { x: 535, y: totalsY + 18 },
      thickness: 1,
      color: rgb(0.9, 0.92, 0.95),
    });
    drawText(page, label, {
      x: totalsXLabel,
      y: totalsY,
      size: 11,
      bold,
      font,
      boldFont,
    });
    drawText(page, value, {
      x: totalsXValue - Math.min(value.length * 4.2, 120),
      y: totalsY,
      size: 11,
      bold: true,
      font,
      boldFont,
    });
    totalsY -= 28;
  }

  const footerLines = [
    `Payment method: ${paymentMethodLabel}`,
    support.url ? `Support site: ${support.url}` : null,
    support.email ? `Support email: ${support.email}` : null,
  ].filter((value): value is string => Boolean(value));

  let footerY = 100;
  for (const line of footerLines) {
    drawText(page, line, {
      x: 58,
      y: footerY,
      size: 10,
      color: [0.35, 0.39, 0.45],
      font,
      boldFont,
    });
    footerY -= 16;
  }

  return doc.save();
}
/**
 * Public document renderer dispatcher.
 *
 *  1. If the invoice carries a frozen template snapshot → template renderer
 *     (historical invoices never change after issuance).
 *  2. Else if the team has an active invoice template → template renderer.
 *  3. Else → the legacy hardcoded renderer, byte-identical to pre-builder
 *     output (covered by golden snapshot tests).
 */
export async function renderBillingDocumentPdf(input: {
  kind: BillingDocumentKind;
  context: NonNullable<LoadedInvoiceContext>;
  receiptNumber?: string | null;
}): Promise<Uint8Array> {
  const resolved = await resolveTemplateConfigForTeam({
    teamId: input.context.invoice.teamId,
    environmentId: input.context.invoice.environmentId ?? null,
    templateId: input.context.invoice.templateId ?? null,
    templateSnapshot: input.context.invoice.templateSnapshot ?? null,
  });
  if (resolved) {
    // Freeze the design on first render (fire-and-forget; must never block
    // or fail PDF generation). Subsequent renders use the snapshot.
    if (!input.context.invoice.templateSnapshot && resolved.templateId) {
      stampInvoiceTemplateSnapshot({
        invoiceId: input.context.invoice.id,
        teamId: input.context.invoice.teamId,
        templateId: resolved.templateId,
        config: resolved.config,
      }).catch((err) => {
        console.warn("[invoice-documents] Failed to stamp template snapshot:", err);
      });
    }
    return renderTemplateInvoicePdf(input, resolved.config);
  }
  return renderLegacyBillingDocumentPdf(input);
}



export async function renderInvoicePdfBytes(input: {
  teamId: string;
  invoiceId: string;
  kind: InvoiceDocumentKind;
}): Promise<{ bytes: Buffer; filename: string; receiptNumber: string | null }> {
  const context = await loadInvoiceBillingContext(input.teamId, input.invoiceId);
  if (!context) throw new Error("Invoice not found");
  if (input.kind === "receipt" && context.invoice.status !== "PAID") {
    throw new Error("Receipt is only available for paid invoices");
  }

  const receiptNumber =
    input.kind === "receipt" ? getStoredReceiptNumber(context) : null;
  const pdfBytes = await renderBillingDocumentPdf({
    kind: input.kind,
    context,
    receiptNumber,
  });

  const filename =
    input.kind === "invoice"
      ? `${sanitizePathSegment(context.invoice.number || context.invoice.id)}.pdf`
      : `${sanitizePathSegment(receiptNumber ?? context.invoice.id)}.pdf`;
  return { bytes: Buffer.from(pdfBytes), filename, receiptNumber };
}

/**
 * Issues a signed render URL. Nothing is rendered or written at this point:
 * the PDF is generated on-demand when the URL is opened (Stripe-style).
 */
export async function getInvoicePdfDownloadUrl(input: {
  teamId: string;
  invoiceId: string;
  kind?: InvoiceDocumentKind;
}): Promise<{ downloadUrl: string }> {
  const context = await loadInvoiceBillingContext(input.teamId, input.invoiceId);
  if (!context) throw new Error("Invoice not found");
  const kind = input.kind ?? "invoice";
  return {
    downloadUrl: createInvoiceDownloadUrl({ invoiceId: context.invoice.id, kind }),
  };
}

/** Compat alias used by routes/webhooks that only need the download URL. */
export async function ensureInvoicePdfForTeam(
  teamId: string,
  invoiceId: string,
): Promise<{ downloadUrl: string }> {
  return getInvoicePdfDownloadUrl({ teamId, invoiceId, kind: "invoice" });
}

/**
 * Verifies a signed render URL and generates the PDF live from the invoice
 * object. Returns null on invalid/expired tokens (same security envelope as
 * the previous object-key flow).
 */
export async function renderSignedInvoicePdf(input: {
  invoiceId: string;
  kind: string;
  expRaw: string;
  signature: string;
}): Promise<{ bytes: Buffer; filename: string } | null> {
  if (
    !verifyInvoiceDownloadToken({
      invoiceId: input.invoiceId,
      kind: input.kind,
      expRaw: input.expRaw,
      signature: input.signature,
    })
  ) {
    return null;
  }

  const kind = input.kind as InvoiceDocumentKind;
  const invoice = await db.invoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, teamId: true },
  });
  if (!invoice) return null;

  try {
    const result = await renderInvoicePdfBytes({
      teamId: invoice.teamId,
      invoiceId: invoice.id,
      kind,
    });
    return { bytes: result.bytes, filename: result.filename };
  } catch {
    // Receipt for unpaid invoice or missing row — treat as not found/denied.
    return null;
  }
}
