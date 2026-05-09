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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function formatMoney(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
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

type InvoicePdfLine = {
  description: string;
  quantity: number;
  unitAmount: unknown;
  lineTax: unknown;
  lineTotal: unknown;
};

type InvoiceForPdf = {
  id: string;
  number: string | null;
  status: string;
  issuedAt: Date | null;
  dueAt: Date | null;
  customerEmail: string | null;
  customerWallet: string | null;
  subtotal: unknown;
  taxTotal: unknown;
  total: unknown;
  currency: string;
  lineItems: InvoicePdfLine[];
};

async function renderInvoicePdf(invoice: InvoiceForPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = 800;

  const drawLine = (
    text: string,
    opts: { x?: number; size?: number; boldText?: boolean; color?: [number, number, number] } = {},
  ) => {
    const size = opts.size ?? 11;
    const x = opts.x ?? 50;
    const color = opts.color || [0.1, 0.12, 0.15];
    page.drawText(text, {
      x,
      y,
      size,
      font: opts.boldText ? bold : font,
      color: rgb(color[0], color[1], color[2]),
    });
    y -= size + 6;
  };

  drawLine("ArcenPay Invoice", { size: 20, boldText: true });
  drawLine(`Invoice #${invoice.number || invoice.id}`, { boldText: true });
  drawLine(`Status: ${invoice.status}`);
  drawLine(`Issued: ${invoice.issuedAt ? invoice.issuedAt.toISOString().slice(0, 10) : "N/A"}`);
  drawLine(`Due: ${invoice.dueAt ? invoice.dueAt.toISOString().slice(0, 10) : "On receipt"}`);
  y -= 8;
  drawLine("Bill To", { size: 12, boldText: true });
  drawLine(`Email: ${invoice.customerEmail || "N/A"}`);
  drawLine(`Wallet: ${invoice.customerWallet || "N/A"}`);
  y -= 8;
  drawLine("Line Items", { size: 12, boldText: true });
  drawLine("Description                               Qty     Unit      Tax       Total", {
    boldText: true,
    size: 10,
    color: [0.35, 0.38, 0.43],
  });

  for (const line of invoice.lineItems) {
    if (y < 120) break;
    const desc = line.description.length > 36
      ? `${line.description.slice(0, 33)}...`
      : line.description;
    drawLine(
      `${desc.padEnd(38)} ${String(line.quantity).padStart(3)}   ${formatMoney(
        String(line.unitAmount),
      ).padStart(7)}  ${formatMoney(String(line.lineTax)).padStart(7)}  ${formatMoney(
        String(line.lineTotal),
      ).padStart(9)}`,
      { size: 10 },
    );
  }

  y -= 8;
  drawLine(`Subtotal: ${formatMoney(String(invoice.subtotal))} ${invoice.currency}`, {
    x: 360,
    boldText: true,
  });
  drawLine(`Tax: ${formatMoney(String(invoice.taxTotal))} ${invoice.currency}`, {
    x: 360,
    boldText: true,
  });
  drawLine(`Total: ${formatMoney(String(invoice.total))} ${invoice.currency}`, {
    x: 360,
    size: 13,
    boldText: true,
  });

  y = 80;
  page.drawText(
    `Generated at ${new Date().toISOString()} by ArcenPay`,
    {
      x: 50,
      y,
      size: 9,
      font,
      color: rgb(0.45, 0.48, 0.52),
    },
  );

  return doc.save();
}

export async function ensureInvoicePdfForTeam(teamId: string, invoiceId: string): Promise<{
  objectKey: string;
  downloadUrl: string;
}> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, teamId },
    include: {
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!invoice) {
    throw new Error("Invoice not found");
  }

  let objectKey = invoice.externalRef || "";
  let existing = objectKey ? await readObject(objectKey) : null;

  if (!existing) {
    const fileSafeNumber = sanitizePathSegment(invoice.number || invoice.id);
    objectKey = `invoices/${invoice.id}/${fileSafeNumber}.pdf`;
    const pdfBytes = await renderInvoicePdf(invoice);
    await writeObject(objectKey, pdfBytes);
    await db.invoice.update({
      where: { id: invoice.id },
      data: { externalRef: objectKey },
    });
  }

  return {
    objectKey,
    downloadUrl: createInvoiceDownloadUrl(invoice.id, objectKey),
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
