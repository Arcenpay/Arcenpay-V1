import { createHmac, timingSafeEqual } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "../../db.js";
import {
  APP_URL,
  INVOICE_STORAGE_DIR,
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
import { renderTemplateInvoicePdf } from "./invoice-builder/renderer.js";
import { resolveTemplateConfigForTeam } from "./invoice-builder/template-store.js";

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

function makeSignedPayload(invoiceId: string, objectKey: string, exp: number): string {
  return `${invoiceId}.${objectKey}.${exp}`;
}

export function createInvoiceDownloadUrl(
  invoiceId: string,
  objectKey: string,
  expiresInSeconds = INVOICE_DOWNLOAD_URL_TTL_SECONDS,
): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = makeSignedPayload(invoiceId, objectKey, exp);
  const sig = signPayload(payload);
  const keyParam = encodeURIComponent(objectKey);
  return `${APP_URL}/api/invoices/public/${encodeURIComponent(
    invoiceId,
  )}/download?key=${keyParam}&exp=${exp}&sig=${encodeURIComponent(sig)}`;
}

export function verifyInvoiceDownloadToken(input: {
  invoiceId: string;
  objectKey: string;
  expRaw: string;
  signature: string;
}): boolean {
  const exp = Number(input.expRaw);
  if (!Number.isFinite(exp)) return false;
  if (Math.floor(Date.now() / 1000) > exp) return false;

  const payload = makeSignedPayload(input.invoiceId, input.objectKey, exp);
  const expected = signPayload(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(input.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function ensureDirForObjectKey(objectKey: string): Promise<string> {
  if (objectKey.includes("..")) {
    throw new Error("Invalid object key");
  }
  const absPath = path.join(INVOICE_STORAGE_DIR, objectKey);
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  return absPath;
}

async function writeObject(objectKey: string, bytes: Uint8Array): Promise<void> {
  const absPath = await ensureDirForObjectKey(objectKey);
  await fs.writeFile(absPath, Buffer.from(bytes));
}

export async function readObject(objectKey: string): Promise<Buffer | null> {
  try {
    const absPath = path.join(INVOICE_STORAGE_DIR, objectKey);
    if (objectKey.includes("..")) return null;
    return await fs.readFile(absPath);
  } catch {
    return null;
  }
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
    drawText(page, line, {
      x: 58,
      y: providerY,
      size: 11,
      font,
      boldFont,
    });
    providerY -= 22;
  }

  let customerY = 560;
  for (const line of customerLines) {
    drawText(page, line, {
      x: 338,
      y: customerY,
      size: 11,
      font,
      boldFont,
    });
    customerY -= 22;
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
  const config = await resolveTemplateConfigForTeam({
    teamId: input.context.invoice.teamId,
    environmentId: input.context.invoice.environmentId ?? null,
    templateId: input.context.invoice.templateId ?? null,
    templateSnapshot: input.context.invoice.templateSnapshot ?? null,
  });
  if (config) {
    return renderTemplateInvoicePdf(input, config);
  }
  return renderLegacyBillingDocumentPdf(input);
}



async function writeReceiptMetadata(
  context: NonNullable<LoadedInvoiceContext>,
  payload: { number: string; objectKey: string },
) {
  await db.invoice.update({
    where: { id: context.invoice.id },
    data: {
      metadata: toPrismaJson({
        ...context.metadata,
        receipt: {
          ...context.receiptMeta,
          number: payload.number,
          objectKey: payload.objectKey,
        },
      }),
    },
  });
}

export async function ensureInvoicePdfForTeam(teamId: string, invoiceId: string): Promise<{
  objectKey: string;
  downloadUrl: string;
}> {
  const context = await loadInvoiceBillingContext(teamId, invoiceId);
  if (!context) {
    throw new Error("Invoice not found");
  }

  let objectKey = context.invoice.externalRef || "";
  const existing = objectKey ? await readObject(objectKey) : null;

  if (!existing) {
    const fileSafeNumber = sanitizePathSegment(context.invoice.number || context.invoice.id);
    objectKey = `invoices/${context.invoice.id}/${fileSafeNumber}.pdf`;
    const pdfBytes = await renderBillingDocumentPdf({
      kind: "invoice",
      context,
    });
    await writeObject(objectKey, pdfBytes);
    await db.invoice.update({
      where: { id: context.invoice.id },
      data: { externalRef: objectKey },
    });
  }

  return {
    objectKey,
    downloadUrl: createInvoiceDownloadUrl(context.invoice.id, objectKey),
  };
}

export async function ensureReceiptPdfForTeam(teamId: string, invoiceId: string): Promise<{
  objectKey: string;
  filename: string;
  receiptNumber: string;
}> {
  const context = await loadInvoiceBillingContext(teamId, invoiceId);
  if (!context) {
    throw new Error("Invoice not found");
  }
  if (context.invoice.status !== "PAID") {
    throw new Error("Receipt is only available for paid invoices");
  }

  const receiptNumber = getStoredReceiptNumber(context);
  let objectKey = readReceiptObjectKey(context) || "";
  const existing = objectKey ? await readObject(objectKey) : null;

  if (!existing) {
    const safeReceiptNumber = sanitizePathSegment(receiptNumber);
    objectKey = `receipts/${context.invoice.id}/${safeReceiptNumber}.pdf`;
    const pdfBytes = await renderBillingDocumentPdf({
      kind: "receipt",
      context,
      receiptNumber,
    });
    await writeObject(objectKey, pdfBytes);
  }

  if (readReceiptObjectKey(context) !== objectKey || context.receiptMeta.number !== receiptNumber) {
    await writeReceiptMetadata(context, { number: receiptNumber, objectKey });
  }

  return {
    objectKey,
    filename: `${sanitizePathSegment(receiptNumber)}.pdf`,
    receiptNumber,
  };
}

export async function readSignedInvoicePdf(params: {
  invoiceId: string;
  objectKey: string;
  expRaw: string;
  signature: string;
}): Promise<{ bytes: Buffer; filename: string } | null> {
  if (
    !verifyInvoiceDownloadToken({
      invoiceId: params.invoiceId,
      objectKey: params.objectKey,
      expRaw: params.expRaw,
      signature: params.signature,
    })
  ) {
    return null;
  }

  const invoice = await db.invoice.findUnique({
    where: { id: params.invoiceId },
    select: { id: true, number: true, externalRef: true },
  });
  if (!invoice || invoice.externalRef !== params.objectKey) {
    return null;
  }

  const bytes = await readObject(params.objectKey);
  if (!bytes) return null;

  const filename = `${sanitizePathSegment(invoice.number || invoice.id)}.pdf`;
  return { bytes, filename };
}
