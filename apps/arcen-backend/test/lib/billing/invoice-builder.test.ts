import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildDefaultInvoiceTemplateConfig } from "../../../src/lib/billing/invoice-builder/default-template.js";
import {
  INVOICE_TEMPLATE_MAX_BYTES,
  type InvoiceTemplateConfig,
} from "../../../src/lib/billing/invoice-builder/types.js";
import { validateInvoiceTemplateConfig } from "../../../src/lib/billing/invoice-builder/schema.js";
import {
  activateInvoiceTemplate,
  deleteInvoiceTemplate,
  ensureInvoiceBuilderDefaultTemplate,
  resolveTemplateConfigForTeam,
  stampInvoiceTemplateSnapshot,
} from "../../../src/lib/billing/invoice-builder/template-store.js";
import { renderTemplateInvoicePdf } from "../../../src/lib/billing/invoice-builder/renderer.js";
import { buildInvoiceContextFixture } from "../../fixtures/invoice-documents.fixture.js";

vi.mock("../../../src/db.js", () => {
  const findFirst = vi.fn();
  const count = vi.fn();
  const create = vi.fn();
  const updateMany = vi.fn();
  const update = vi.fn();
  const deleteFn = vi.fn();
  const transaction = vi.fn((fn: (tx: Record<string, unknown>) => Promise<unknown>) =>
    fn({
      invoiceTemplate: { findFirst, updateMany, update, delete: deleteFn },
    }),
  );
  return {
    db: {
      invoiceTemplate: { findFirst, count, create, updateMany, update, delete: deleteFn },
      invoice: { updateMany },
      $transaction: transaction,
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
    expect(resolved).toEqual({ config: snapshot, templateId: null });
    expect(mockDb.invoiceTemplate.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the active template when no snapshot exists", async () => {
    const active = buildDefaultInvoiceTemplateConfig();
    mockDb.invoiceTemplate.findFirst.mockResolvedValue({ id: "template-1", config: active });
    const resolved = await resolveTemplateConfigForTeam({
      teamId: "team-1",
      environmentId: "env-1",
      templateId: null,
      templateSnapshot: null,
    });
    expect(resolved).toEqual({ config: active, templateId: "template-1" });
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


describe("invoice builder — default seeding & snapshot stamping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seeds + activates the Classic template on first visit for Plus/Pro", async () => {
    mockDb.invoiceTemplate.count.mockResolvedValueOnce(0);
    mockDb.invoiceTemplate.create.mockResolvedValueOnce({ id: "template-seeded" });
    const result = await ensureInvoiceBuilderDefaultTemplate({
      teamId: "team-1",
      environmentId: null,
      tierAllowed: true,
    });
    expect(result).toEqual({ seeded: true, activated: true });
    const data = mockDb.invoiceTemplate.create.mock.calls[0][0].data;
    expect(data.isActive).toBe(true);
    expect(data.name).toBe("Classic");
    expect(data.teamId).toBe("team-1");
  });

  it("never seeds for FREE tier", async () => {
    const result = await ensureInvoiceBuilderDefaultTemplate({
      teamId: "team-1",
      environmentId: null,
      tierAllowed: false,
    });
    expect(result).toEqual({ seeded: false, activated: false });
    expect(mockDb.invoiceTemplate.count).not.toHaveBeenCalled();
  });

  it("is a no-op when the team already has templates (idempotent)", async () => {
    mockDb.invoiceTemplate.count.mockResolvedValueOnce(3);
    const result = await ensureInvoiceBuilderDefaultTemplate({
      teamId: "team-1",
      environmentId: "env-1",
      tierAllowed: true,
    });
    expect(result).toEqual({ seeded: false, activated: false });
    expect(mockDb.invoiceTemplate.create).not.toHaveBeenCalled();
  });

  it("stamps a snapshot only once (idempotent freeze)", async () => {
    const config = buildDefaultInvoiceTemplateConfig();
    mockDb.invoice.updateMany.mockResolvedValueOnce({ count: 1 });
    const stamped = await stampInvoiceTemplateSnapshot({
      invoiceId: "invoice-1",
      teamId: "team-1",
      templateId: "template-1",
      config,
    });
    expect(stamped).toBe(true);
    const where = mockDb.invoice.updateMany.mock.calls[0][0].where;
    expect(where.id).toBe("invoice-1");
    expect(where.templateSnapshot).toMatchObject({
      equals: expect.any(Object),
    });

    mockDb.invoice.updateMany.mockResolvedValueOnce({ count: 0 });
    const again = await stampInvoiceTemplateSnapshot({
      invoiceId: "invoice-1",
      teamId: "team-1",
      templateId: "template-1",
      config,
    });
    expect(again).toBe(false);
  });

  it("activating a template deactivates its siblings atomically (idempotent)", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValueOnce({
      id: "template-2",
      environmentId: null,
    });
    mockDb.invoiceTemplate.findFirst.mockResolvedValueOnce(null);
    mockDb.invoiceTemplate.updateMany.mockResolvedValueOnce({ count: 0 });
    mockDb.invoiceTemplate.update.mockResolvedValueOnce({ id: "template-2" });
    const result = await activateInvoiceTemplate({
      teamId: "team-1",
      id: "template-2",
      environmentId: null,
    });
    expect(result).toEqual({ ok: true, alreadyActive: false });
  });

  it("refuses to delete a protected (seeded default) template", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValueOnce({
      id: "template-default",
      isProtected: true,
    });
    const result = await deleteInvoiceTemplate({
      teamId: "team-1",
      id: "template-default",
    });
    expect(result).toEqual({ deleted: false, protected: true });
    expect(mockDb.invoiceTemplate.delete).not.toHaveBeenCalled();
  });

  it("deletes custom templates normally", async () => {
    mockDb.invoiceTemplate.findFirst.mockResolvedValueOnce({
      id: "template-custom",
      isProtected: false,
    });
    mockDb.invoiceTemplate.delete.mockResolvedValueOnce({ id: "template-custom" });
    const result = await deleteInvoiceTemplate({
      teamId: "team-1",
      id: "template-custom",
    });
    expect(result).toEqual({ deleted: true });
  });
});
