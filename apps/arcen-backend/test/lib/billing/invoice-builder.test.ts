import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildDefaultInvoiceTemplateConfig } from "../../../src/lib/billing/invoice-builder/default-template.js";
import {
  INVOICE_TEMPLATE_MAX_BYTES,
  type InvoiceTemplateConfig,
} from "../../../src/lib/billing/invoice-builder/types.js";
import { validateInvoiceTemplateConfig } from "../../../src/lib/billing/invoice-builder/schema.js";
import { resolveTemplateConfigForTeam } from "../../../src/lib/billing/invoice-builder/template-store.js";
import { renderTemplateInvoicePdf } from "../../../src/lib/billing/invoice-builder/renderer.js";
import { buildInvoiceContextFixture } from "../../fixtures/invoice-documents.fixture.js";

vi.mock("../../../src/db.js", () => {
  const findFirst = vi.fn();
  return {
    db: {
      invoiceTemplate: { findFirst },
    },
  };
});

import { db } from "../../../src/db.js";

const mockDb = db as any;

function makeConfig(overrides: Partial<InvoiceTemplateConfig> = {}): InvoiceTemplateConfig {
  return {
    ...buildDefaultInvoiceTemplateConfig(),
    ...overrides,
  } as InvoiceTemplateConfig;
}

const context = buildInvoiceContextFixture();

describe("invoice builder — config validation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts the default config", () => {
    const result = validateInvoiceTemplateConfig(buildDefaultInvoiceTemplateConfig());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sections.map((s) => s.type)).toEqual([
        "header",
        "metadata",
        "addresses",
        "itemsTable",
        "totals",
        "footer",
      ]);
    }
  });

  it("rejects an unsupported section type", () => {
    const broken = makeConfig();
    (broken.sections as Array<Record<string, unknown>>).push({
      type: "shinySection",
      visible: true,
    });
    const result = validateInvoiceTemplateConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("sections");
  });

  it("rejects duplicate sections", () => {
    const broken = makeConfig();
    (broken.sections as Array<Record<string, unknown>>).push({
      ...broken.sections[0],
    });
    const result = validateInvoiceTemplateConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("duplicate");
  });

  it("rejects invalid hex colors", () => {
    const broken = makeConfig();
    (broken.style as Record<string, unknown>).primaryColor = "notAColor";
    const result = validateInvoiceTemplateConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("primaryColor");
  });

  it("rejects column widths that exceed 100%", () => {
    const broken = makeConfig();
    const table = broken.sections.find((s) => s.type === "itemsTable");
    if (table?.type === "itemsTable") {
      table.columnWidths = { description: 0.6, qty: 0.2, unitPrice: 0.3, amount: 0.3 };
    }
    const result = validateInvoiceTemplateConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("columnWidths");
  });

  it("rejects payloads larger than the 64KB limit", () => {
    const big = makeConfig();
    (big.meta as { name: string }).name = "x".repeat(INVOICE_TEMPLATE_MAX_BYTES + 1);
    const result = validateInvoiceTemplateConfig(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("64KB");
  });

  it("rejects unknown top-level properties", () => {
    const result = validateInvoiceTemplateConfig({
      ...buildDefaultInvoiceTemplateConfig(),
      rogueProperty: 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("invoice builder — template resolution", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the frozen snapshot when present (immutability)", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValue(null);
    const snapshot = buildDefaultInvoiceTemplateConfig();
    const resolved = await resolveTemplateConfigForTeam({
      teamId: "team-1",
      environmentId: null,
      templateId: null,
      templateSnapshot: { config: snapshot },
    });
    expect(resolved).toEqual(snapshot);
    expect(mockDb.invoiceTemplate.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the active template when no snapshot exists", async () => {
    const active = buildDefaultInvoiceTemplateConfig();
    mockDb.invoiceTemplate.findFirst.mockResolvedValue({ config: active });
    const resolved = await resolveTemplateConfigForTeam({
      teamId: "team-1",
      environmentId: "env-1",
      templateId: null,
      templateSnapshot: null,
    });
    expect(resolved).toEqual(active);
  });

  it("returns null (legacy path) when there is no snapshot and no active template", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValue(null);
    const resolved = await resolveTemplateConfigForTeam({
      teamId: "team-1",
      environmentId: null,
      templateId: null,
      templateSnapshot: null,
    });
    expect(resolved).toBeNull();
  });

  it("ignores a corrupt snapshot instead of crashing", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValue(null);
    const resolved = await resolveTemplateConfigForTeam({
      teamId: "team-1",
      environmentId: null,
      templateId: "template-1",
      templateSnapshot: { config: { not: "a valid config" } },
    });
    expect(resolved).toBeNull();
  });
});

describe("invoice builder — template rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a valid single-page PDF from the default template config", async () => {
    const bytes = await renderTemplateInvoicePdf(
      { kind: "invoice", context },
      buildDefaultInvoiceTemplateConfig(),
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const page = doc.getPages()[0];
    expect([page.getWidth(), page.getHeight()]).toEqual([595, 842]);
  });

  it("renders deterministic bytes (same input → identical output)", async () => {
    const config = buildDefaultInvoiceTemplateConfig();
    const first = await renderTemplateInvoicePdf({ kind: "invoice", context }, config);
    const second = await renderTemplateInvoicePdf({ kind: "invoice", context }, config);
    expect(Buffer.from(first).toString("base64")).toBe(Buffer.from(second).toString("base64"));
  });

  it("renders a PAID receipt with watermark configuration", async () => {
    const config = buildDefaultInvoiceTemplateConfig();
    const paidContext = {
      ...context,
      invoice: {
        ...context.invoice,
        status: "PAID",
        paidAt: new Date("2026-09-18T00:00:00.000Z"),
        amountPaid: 1089,
        amountOutstanding: 0,
      },
    } as NonNullable<typeof context>;
    const bytes = await renderTemplateInvoicePdf(
      { kind: "receipt", context: paidContext, receiptNumber: "RCT-2026-000042" },
      config,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("honors landscape orientation", async () => {
    const config = makeConfig({
      style: { ...buildDefaultInvoiceTemplateConfig().style, pageOrientation: "landscape" },
    });
    const bytes = await renderTemplateInvoicePdf({ kind: "invoice", context }, config);
    const doc = await PDFDocument.load(bytes);
    const page = doc.getPages()[0];
    expect([page.getWidth(), page.getHeight()]).toEqual([842, 595]);
  });
});

