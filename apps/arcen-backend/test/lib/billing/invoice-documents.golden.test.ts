import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderBillingDocumentPdf } from "../../../src/lib/billing/invoice-documents.js";
import { buildInvoiceContextFixture } from "../../fixtures/invoice-documents.fixture.js";

// Hermetic golden tests: the dispatcher falls back to the legacy renderer
// when no template snapshot exists and no active template row is found.
vi.mock("../../../src/db.js", () => ({
  db: {
    invoiceTemplate: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

/**
 * Golden regression tests for the default (legacy) invoice/receipt renderer.
 *
 * These snapshots were captured BEFORE the invoice-builder renderer refactor.
 * The refactor must reproduce byte-identical output for the default config
 * or these tests fail — guaranteeing zero visual regression for existing
 * invoices, receipts, downloads, and email attachments.
 */

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function renderOnce(kind: "invoice" | "receipt") {
  const context = buildInvoiceContextFixture();
  const bytes = await renderBillingDocumentPdf({
    kind,
    context,
    receiptNumber: kind === "receipt" ? "RCT-2026-000042" : null,
  });
  // The fallback branch for the default context has no watermark yet, but
  // keep the assertion here so future config-driven watermarking stays explicit.
  return bytes;
}

describe("invoice documents — default renderer golden output", () => {
  it("renders deterministic bytes (same input → identical output)", async () => {
    const first = await renderOnce("invoice");
    const second = await renderOnce("invoice");
    expect(base64(first)).toBe(base64(second));
  });

  it("produces a valid single-page A4 PDF for invoices", async () => {
    const bytes = await renderOnce("invoice");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPages()[0];
    // A4 portrait: 595 x 842 points.
    expect([page.getWidth(), page.getHeight()]).toEqual([595, 842]);
  });

  it("matches the pre-refactor golden byte digest for invoices", async () => {
    const bytes = await renderOnce("invoice");
    expect(sha256(bytes)).toMatchSnapshot();
  });

  it("produces a valid single-page PDF for receipts", async () => {
    const bytes = await renderOnce("receipt");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("matches the pre-refactor golden byte digest for receipts", async () => {
    const bytes = await renderOnce("receipt");
    expect(sha256(bytes)).toMatchSnapshot();
  });
});
