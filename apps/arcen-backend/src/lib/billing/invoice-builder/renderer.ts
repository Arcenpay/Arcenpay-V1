import { ColorTypes, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import {
  getCustomerAddressLines,
  getPaymentMethodLabel,
  getProviderAddressLines,
  getProviderDisplayName,
  getStoredReceiptNumber,
  getSupportDetails,
  type LoadedInvoiceContext,
} from "../invoice-context.js";
import { readObject } from "../invoice-documents.js";
import { wrapColumnText } from "../utils.js";
import type {
  InvoiceSection,
  InvoiceTemplateConfig,
} from "./types.js";

/**
 * Declarative invoice/receipt renderer.
 *
 * Interprets a validated `InvoiceTemplateConfig` with pdf-lib: ordered
 * sections are drawn top-down on a cursor-based canvas. The default/legacy
 * output PATH IS UNTOUCHED — this renderer only runs when a provider has an
 * explicit invoice template (Plus/Pro tier). Anything invalid falls back to
 * the legacy renderer upstream, never here.
 */

type RenderKind = "invoice" | "receipt";

// ── Small drawing helpers ────────────────────────────────────────────────────

const MARGIN_X = 58;
const EDGE_X = 535; // right content edge
const PAGE_MARGIN = 40;

function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((char) => char + char)
          .join("")
      : clean.padEnd(6, "0").slice(0, 6);
  const value = Number.parseInt(full, 16);
  return rgb(((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255);
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

function wrapText(text: string, maxLength = 46): string[] {
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

interface RenderCtx {
  page: PDFPage;
  font: PDFFont;
  boldFont: PDFFont;
  config: InvoiceTemplateConfig;
  context: NonNullable<LoadedInvoiceContext>;
  kind: RenderKind;
  receiptNumber?: string | null;
  left: number;
  right: number;
  y: number;
}

function sectionFor(
  config: InvoiceTemplateConfig,
  type: InvoiceSection["type"],
): InvoiceSection | undefined {
  return config.sections.find((section) => section.type === type && section.visible);
}

function styleOf(config: InvoiceTemplateConfig) {
  return config.style;
}

function kindTitle(kind: RenderKind, override: string | null): string {
  return override ?? (kind === "invoice" ? "Invoice" : "Receipt");
}

function isOverdue(context: RenderCtx["context"]): boolean {
  const invoice = context.invoice;
  if (invoice.status === "OVERDUE") return true;
  if (invoice.status !== "ISSUED") return false;
  const dueAt = invoice.dueAt ?? invoice.issuedAt ?? null;
  return Boolean(dueAt && dueAt.getTime() < Date.now());
}

async function drawLogo(doc: PDFDocument, objectKey: string, maxHeight: number) {
  const bytes = await readObject(objectKey);
  if (!bytes || bytes.length === 0) return null;
  const isPng =
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

  let image: PDFImage | null = null;
  if (isPng) image = await doc.embedPng(bytes);
  else if (isJpeg) image = await doc.embedJpg(bytes);
  if (!image) return null;

  const scale = maxHeight / image.height;
  return {
    image,
    width: image.width * scale,
    height: image.height * scale,
  };
}

function drawText(
  page: PDFPage,
  text: string,
  options: {
    x: number;
    y: number;
    size?: number;
    bold?: boolean;
    color?: RGB;
    font: PDFFont;
    boldFont: PDFFont;
  },
) {
  page.drawText(text, {
    x: options.x,
    y: options.y,
    size: options.size ?? 11,
    font: options.bold ? options.boldFont : options.font,
    color: options.color ?? rgb(0.09, 0.11, 0.14),
  });
}

function drawRule(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  color: RGB,
) {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: 1,
    color,
  });
}
// ── Section drawers ──────────────────────────────────────────────────────────

async function drawHeader(ctx: RenderCtx, doc: PDFDocument): Promise<number> {
  const section = sectionFor(ctx.config, "header") as
    | Extract<InvoiceSection, { type: "header" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const primary = hexToRgb(style.primaryColor);
  const muted = hexToRgb(style.mutedColor);
  let y = ctx.y;

  const logo =
    section.showLogo && section.logoObjectKey
      ? await drawLogo(doc, section.logoObjectKey, style.logoMaxHeight)
      : null;
  if (logo) {
    const logoX = section.align === "center" ? ctx.left + (ctx.right - ctx.left) / 2 - logo.width / 2 : ctx.left;
    ctx.page.drawImage(logo.image, { x: logoX, y: y - logo.height, width: logo.width, height: logo.height });
    y -= logo.height + 14;
  }

  const title = kindTitle(ctx.kind, section.title);
  const titleSize = 26;
  const providerName = getProviderDisplayName(ctx.context);
  const titleX =
    section.align === "center"
      ? ctx.left + (ctx.right - ctx.left) / 2 - (title.length * titleSize * 0.55) / 2
      : ctx.left;
  drawText(ctx.page, title, { x: titleX, y, size: titleSize, bold: true, color: primary, font: ctx.font, boldFont: ctx.boldFont });
  y -= 24;
  drawText(ctx.page, providerName, { x: ctx.left, y, size: 12, color: muted, font: ctx.font, boldFont: ctx.boldFont });
  y -= 18;

  if (section.accentBar) {
    drawRule(ctx.page, ctx.left, y, ctx.right - ctx.left, hexToRgb(style.accentColor));
    y -= 14;
  }
  return y - 6;
}

function drawMetadata(ctx: RenderCtx): number {
  const section = sectionFor(ctx.config, "metadata") as
    | Extract<InvoiceSection, { type: "metadata" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const primary = hexToRgb(style.primaryColor);
  const muted = hexToRgb(style.mutedColor);
  const invoice = ctx.context.invoice;
  const receiptNumber = ctx.receiptNumber ?? getStoredReceiptNumber(ctx.context);

  const values: Array<[string, string]> =
    ctx.kind === "invoice"
      ? [
          ...(section.showInvoiceNumber ? [["Invoice number", invoice.number || invoice.id] as [string, string]] : []),
          ...(section.showIssueDate ? [["Date of issue", formatDateLong(invoice.issuedAt || invoice.createdAt)] as [string, string]] : []),
          ...(section.showDueDate ? [["Date due", formatDateLong(invoice.dueAt || invoice.issuedAt || invoice.createdAt)] as [string, string]] : []),
        ]
      : [
          ...(section.showInvoiceNumber ? [["Invoice number", invoice.number || invoice.id] as [string, string]] : []),
          ...(section.showReceiptNumber ? [["Receipt number", receiptNumber] as [string, string]] : []),
          ...(section.showPaidDate ? [["Date paid", formatDateLong(invoice.paidAt || invoice.updatedAt)] as [string, string]] : []),
        ];
  if (values.length === 0) return ctx.y;

  const rowHeight = 18;
  const columns = section.columns === 2 ? 2 : 1;
  const gap = 40;
  const colWidth = (ctx.right - ctx.left - gap) / columns;
  let y = ctx.y;

  for (let index = 0; index < values.length; index += columns) {
    for (let col = 0; col < columns; col++) {
      const entry = values[index + col];
      if (!entry) continue;
      const x = ctx.left + col * (colWidth + gap);
      drawText(ctx.page, entry[0], { x, y, size: 10, color: muted, font: ctx.font, boldFont: ctx.boldFont });
      drawText(ctx.page, entry[1], { x: x + Math.min(96, colWidth * 0.6), y, size: 11, bold: true, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    }
    y -= rowHeight;
  }
  return y - 6;
}

function drawAddresses(ctx: RenderCtx): number {
  const section = sectionFor(ctx.config, "addresses") as
    | Extract<InvoiceSection, { type: "addresses" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const primary = hexToRgb(style.primaryColor);
  const fromTitle = section.fromTitle || "From";
  const billToTitle = section.billToTitle || "Bill to";
  const midX = ctx.left + Math.min(280, (ctx.right - ctx.left) * 0.58);

  const providerName = getProviderDisplayName(ctx.context);
  const fromLines = [
    providerName,
    ...getProviderAddressLines(ctx.context).filter((line) => line !== providerName),
  ];
  const toLines = getCustomerAddressLines(ctx.context);
  // Column-aware wrapping keeps long values (wallets, emails) inside the
  // portrait page edges instead of overflowing.
  const wrappedFrom = fromLines.flatMap((line) =>
    line ? wrapColumnText(line, 46) : [],
  );
  const wrappedTo = toLines.flatMap((line) =>
    line ? wrapColumnText(line, 30) : [],
  );
  const rows = Math.max(wrappedFrom.length, wrappedTo.length, 1);
  let y = ctx.y;

  if (section.showFrom) {
    drawText(ctx.page, fromTitle, { x: ctx.left, y, size: 11, bold: true, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    wrappedFrom.forEach((line, index) => {
      drawText(ctx.page, line, { x: ctx.left, y: y - 16 - index * 16, size: 11, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    });
  }
  if (section.showBillTo) {
    drawText(ctx.page, billToTitle, { x: midX, y, size: 11, bold: true, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    wrappedTo.forEach((line, index) => {
      drawText(ctx.page, line, { x: midX, y: y - 16 - index * 16, size: 11, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    });
  }
  return y - rows * 16 - 20;
}

function drawItemsTable(ctx: RenderCtx): number {
  const section = sectionFor(ctx.config, "itemsTable") as
    | Extract<InvoiceSection, { type: "itemsTable" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const primary = hexToRgb(style.primaryColor);
  const muted = hexToRgb(style.mutedColor);
  const border = hexToRgb(style.borderColor);
  const width = ctx.right - ctx.left;

  const colDefs = [
    { key: "description" as const, label: "Description" },
    { key: "qty" as const, label: "Qty" },
    { key: "unitPrice" as const, label: "Unit price" },
    { key: "amount" as const, label: "Amount" },
  ];
  const widths = [
    section.columnWidths.description,
    section.columnWidths.qty,
    section.columnWidths.unitPrice,
    section.columnWidths.amount,
  ];
  const sum = Math.max(widths.reduce((total, value) => total + value, 0), 0.1);
  const xs: number[] = [];
  let x = ctx.left;
  for (const w of widths) {
    xs.push(x);
    x += (w / sum) * width;
  }
  const rightEdge = ctx.right;

  let y = ctx.y;
  drawRule(ctx.page, ctx.left, y, width, border);
  colDefs.forEach((col, index) => {
    drawText(ctx.page, col.label, {
      x: index > 0 ? xs[index] + 6 : xs[index],
      y: y - 12,
      size: 10,
      bold: true,
      color: muted,
      font: ctx.font,
      boldFont: ctx.boldFont,
    });
  });
  const headerY = y - 26;
  drawRule(ctx.page, ctx.left, headerY, width, border);
  y = headerY - 14;

  for (const line of ctx.context.invoice.lineItems) {
    const descriptionLines = wrapText(line.description, 44);
    const rowHeight = Math.max(26, descriptionLines.length * 14 + 10);
    descriptionLines.forEach((chunk, index) => {
      drawText(ctx.page, chunk, {
        x: xs[0],
        y: y - index * 14 - 4,
        size: 11,
        bold: index === 0,
        color: primary,
        font: ctx.font,
        boldFont: ctx.boldFont,
      });
    });
    const qty = String(line.quantity);
    const unitPrice = formatMoney(String(line.unitAmount));
    const amount = formatMoney(String(line.lineTotal));
    drawText(ctx.page, qty, { x: xs[1] + 6, y: y - 4, size: 11, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    drawText(ctx.page, unitPrice, { x: xs[2] + 6, y: y - 4, size: 11, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    drawText(ctx.page, amount, {
      x: rightEdge - Math.min(amount.length * 4.2, 110),
      y: y - 4,
      size: 11,
      bold: true,
      color: primary,
      font: ctx.font,
      boldFont: ctx.boldFont,
    });
    y -= rowHeight;
  }
  return y - 10;
}

function drawTotals(ctx: RenderCtx): number {
  const section = sectionFor(ctx.config, "totals") as
    | Extract<InvoiceSection, { type: "totals" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const primary = hexToRgb(style.primaryColor);
  const border = hexToRgb(style.borderColor);
  const invoice = ctx.context.invoice;
  const currency = invoice.currency;
  const amountPaid =
    Number(invoice.amountPaid) > 0 ? String(invoice.amountPaid) : String(invoice.total);
  const amountDue =
    Number(invoice.amountOutstanding) > 0 ? String(invoice.amountOutstanding) : String(invoice.total);

  const rows: Array<[string, string, boolean]> = [];
  if (section.showSubtotal) rows.push(["Subtotal", `${formatMoney(String(invoice.subtotal))} ${currency}`, false]);
  if (section.showTax && Number(invoice.taxTotal) > 0) rows.push(["Tax", `${formatMoney(String(invoice.taxTotal))} ${currency}`, false]);
  if (section.showTotal) rows.push(["Total", `${formatMoney(String(invoice.total))} ${currency}`, true]);
  if (ctx.kind === "receipt" && section.showAmountPaid) rows.push(["Amount paid", `${formatMoney(amountPaid)} ${currency}`, true]);
  if (ctx.kind === "invoice" && section.showAmountDue) rows.push(["Amount due", `${formatMoney(amountDue)} ${currency}`, true]);
  if (rows.length === 0) return ctx.y;

  const labelX = ctx.right - 210;
  let y = ctx.y;
  for (const [label, value, bold] of rows) {
    drawRule(ctx.page, labelX, y + 16, ctx.right - labelX, border);
    drawText(ctx.page, label, { x: labelX, y, size: 11, bold, color: primary, font: ctx.font, boldFont: ctx.boldFont });
    drawText(ctx.page, value, {
      x: ctx.right - Math.min(value.length * 4.2, 130),
      y,
      size: bold ? 11 : 10,
      bold: true,
      color: primary,
      font: ctx.font,
      boldFont: ctx.boldFont,
    });
    y -= 26;
  }
  return y - 4;
}

function drawFooter(ctx: RenderCtx): number {
  const section = sectionFor(ctx.config, "footer") as
    | Extract<InvoiceSection, { type: "footer" }>
    | undefined;
  if (!section) return ctx.y;
  const style = styleOf(ctx.config);
  const muted = hexToRgb(style.mutedColor);
  const support = getSupportDetails(ctx.context);
  let y = ctx.y;

  if (section.note) {
    for (const line of wrapText(section.note, 90)) {
      drawText(ctx.page, line, { x: ctx.left, y, size: 10, color: muted, font: ctx.font, boldFont: ctx.boldFont });
      y -= 14;
    }
  }
  const lines: string[] = [];
  if (section.showPaymentMethod) {
    lines.push(`Payment method: ${getPaymentMethodLabel(ctx.context)}`);
  }
  if (section.showSupport) {
    if (support.url) lines.push(`Support site: ${support.url}`);
    if (support.email) lines.push(`Support email: ${support.email}`);
    if (support.phone) lines.push(`Support phone: ${support.phone}`);
  }
  for (const line of lines) {
    drawText(ctx.page, line, { x: ctx.left, y, size: 10, color: muted, font: ctx.font, boldFont: ctx.boldFont });
    y -= 14;
  }
  return y - 2;
}

function blendWithBackground(foreground: RGB, background: RGB, alpha: number): RGB {
  return {
    type: ColorTypes.RGB,
    red: foreground.red * alpha + background.red * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
  };
}

function drawWatermark(ctx: RenderCtx): void {
  const style = styleOf(ctx.config);
  const text =
    ctx.kind === "receipt" && ctx.context.invoice.status === "PAID" && ctx.config.watermark.onPaid
      ? ctx.config.watermark.onPaid
      : ctx.kind === "invoice" && isOverdue(ctx.context) && ctx.config.watermark.onOverdue
        ? ctx.config.watermark.onOverdue
        : null;
  if (!text) return;

  const color = blendWithBackground(hexToRgb(style.accentColor), hexToRgb(style.backgroundColor), 0.16);
  const pageWidth = ctx.page.getWidth();
  const pageHeight = ctx.page.getHeight();
  ctx.page.drawText(text, {
    x: pageWidth / 2,
    y: pageHeight / 2,
    size: 56,
    color,
    rotate: degrees(35),
  });
}

// ── Main entry ───────────────────────────────────────────────────────────────

/**
 * Renders an invoice/receipt PDF from a validated template config.
 * Returns the saved PDF bytes. Callers resolve the config (snapshot →
 * active template → legacy) before invoking this.
 */
export async function renderTemplateInvoicePdf(
  input: {
    kind: RenderKind;
    context: NonNullable<LoadedInvoiceContext>;
    receiptNumber?: string | null;
  },
  config: InvoiceTemplateConfig,
): Promise<Uint8Array> {
  const { context } = input;
  const invoice = context.invoice;
  const style = styleOf(config);

  const landscape = style.pageOrientation === "landscape";
  const pageWidth = landscape ? 842 : 595;
  const pageHeight = landscape ? 595 : 842;

  const doc = await PDFDocument.create();
  const docDate = invoice.issuedAt ?? new Date(0);
  doc.setCreationDate(docDate);
  doc.setModificationDate(docDate);
  const page = doc.addPage([pageWidth, pageHeight]);

  const [font, boldFont] =
    style.fontFamily === "courier"
      ? [await doc.embedFont(StandardFonts.Courier), await doc.embedFont(StandardFonts.CourierBold)]
      : [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold)];

  // Background + bordered content container (legacy visual baseline).
  page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: pageHeight, color: hexToRgb(style.backgroundColor) });
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: PAGE_MARGIN,
    width: pageWidth - PAGE_MARGIN * 2,
    height: pageHeight - PAGE_MARGIN * 2,
    color: hexToRgb(style.backgroundColor),
    borderColor: hexToRgb(style.borderColor),
    borderWidth: 1,
  });

  const left = MARGIN_X;
  const right = pageWidth - 60;
  const ctx: RenderCtx = {
    page,
    font,
    boldFont,
    config,
    context,
    kind: input.kind,
    receiptNumber: input.receiptNumber ?? null,
    left,
    right,
    y: pageHeight - PAGE_MARGIN - 44,
  };

  for (const section of config.sections) {
    if (!section.visible) continue;
    switch (section.type) {
      case "header":
        ctx.y = await drawHeader(ctx, doc);
        break;
      case "metadata":
        ctx.y = drawMetadata(ctx);
        break;
      case "addresses":
        ctx.y = drawAddresses(ctx);
        break;
      case "itemsTable":
        ctx.y = drawItemsTable(ctx);
        break;
      case "totals":
        ctx.y = drawTotals(ctx);
        break;
      case "footer":
        ctx.y = drawFooter(ctx);
        break;
      default:
        break;
    }
  }

  drawWatermark(ctx);
  return doc.save();
}

