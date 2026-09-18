import { z } from "zod";
import {
  INVOICE_BUILDER_SCHEMA_VERSION,
  INVOICE_TEMPLATE_MAX_BYTES,
  type InvoiceSection,
  type InvoiceTemplateConfig,
} from "./types.js";

/**
 * Invoice builder config validation.
 *
 * The schema is intentionally allowlist-only (mirrors the reference
 * LAYOUT.md rules): unknown properties, section types, enum values or
 * non-compliant layouts are rejected before they ever reach the renderer
 * or production storage.
 */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "colors must be #RRGGBB hex values");

const fontFamily = z.enum(["helvetica", "courier"]);
const sectionAlign = z.enum(["left", "center"]);
const pageOrientation = z.enum(["portrait", "landscape"]);

const styleSchema = z
  .object({
    primaryColor: hexColor,
    accentColor: hexColor,
    mutedColor: hexColor,
    borderColor: hexColor,
    backgroundColor: hexColor,
    fontFamily,
    baseFontSize: z
      .number()
      .min(8)
      .max(16, "baseFontSize must be between 8 and 16"),
    logoMaxHeight: z.number().min(24).max(120, "logoMaxHeight must be 24–120px"),
    pageOrientation,
  })
  .strict();

const headerSectionSchema = z
  .object({
    type: z.literal("header"),
    visible: z.boolean(),
    showLogo: z.boolean(),
    logoObjectKey: z.string().max(512).nullable(),
    title: z.string().max(120).nullable(),
    align: sectionAlign,
    accentBar: z.boolean(),
  })
  .strict();

const metadataSectionSchema = z
  .object({
    type: z.literal("metadata"),
    visible: z.boolean(),
    columns: z.union([z.literal(1), z.literal(2)]),
    showInvoiceNumber: z.boolean(),
    showIssueDate: z.boolean(),
    showDueDate: z.boolean(),
    showReceiptNumber: z.boolean(),
    showPaidDate: z.boolean(),
  })
  .strict();

const addressesSectionSchema = z
  .object({
    type: z.literal("addresses"),
    visible: z.boolean(),
    showFrom: z.boolean(),
    showBillTo: z.boolean(),
    fromTitle: z.string().max(60),
    billToTitle: z.string().max(60),
  })
  .strict();

const itemsTableSectionSchema = z
  .object({
    type: z.literal("itemsTable"),
    visible: z.boolean(),
    columnWidths: z
      .object({
        description: z.number().min(0).max(1),
        qty: z.number().min(0).max(1),
        unitPrice: z.number().min(0).max(1),
        amount: z.number().min(0).max(1),
      })
      .strict(),
  })
  .refine(
    (value) => {
      const total = Object.values(value.columnWidths).reduce((sum, width) => sum + width, 0);
      return total <= 1.0001;
    },
    { message: "columnWidths must sum to at most 1" },
  );

const totalsSectionSchema = z
  .object({
    type: z.literal("totals"),
    visible: z.boolean(),
    showSubtotal: z.boolean(),
    showTax: z.boolean(),
    showTotal: z.boolean(),
    showAmountPaid: z.boolean(),
    showAmountDue: z.boolean(),
  })
  .strict();

const footerSectionSchema = z
  .object({
    type: z.literal("footer"),
    visible: z.boolean(),
    showPaymentMethod: z.boolean(),
    showSupport: z.boolean(),
    note: z.string().max(500).nullable(),
  })
  .strict();

const sectionSchemas = [
  headerSectionSchema,
  metadataSectionSchema,
  addressesSectionSchema,
  itemsTableSectionSchema,
  totalsSectionSchema,
  footerSectionSchema,
] as const;

const sectionSchema = z.union(sectionSchemas);

const watermarkSchema = z
  .object({
    onPaid: z.string().max(40).nullable(),
    onOverdue: z.string().max(40).nullable(),
  })
  .strict();

const configSchema = z
  .object({
    schemaVersion: z.literal(INVOICE_BUILDER_SCHEMA_VERSION),
    meta: z
      .object({
        name: z.string().trim().min(1).max(120),
        description: z.string().max(500).optional(),
      })
      .strict(),
    style: styleSchema,
    sections: z
      .array(sectionSchema)
      .min(0)
      .max(12, "too many sections")
      .superRefine((sections, ctx) => {
        const seen = new Set<string>();
        for (const section of sections) {
          if (seen.has(section.type)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate section of type "${section.type}"`,
            });
          }
          seen.add(section.type);
        }
      }),
    watermark: watermarkSchema,
  })
  .strict();

export type InvoiceTemplateValidationResult =
  | { ok: true; config: InvoiceTemplateConfig }
  | { ok: false; errors: string[] };

function serializeSizeLimit(value: unknown, maxBytes: number): boolean {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

/**
 * Validates an unknown value against the invoice builder schema.
 * Rejects unsupported properties, enum values, duplicate sections and any
 * payload larger than the 64KB template limit.
 */
export function validateInvoiceTemplateConfig(
  value: unknown,
): InvoiceTemplateValidationResult {
  if (!serializeSizeLimit(value, INVOICE_TEMPLATE_MAX_BYTES)) {
    return {
      ok: false,
      errors: [`config exceeds the ${INVOICE_TEMPLATE_MAX_BYTES / 1024}KB template limit`],
    };
  }

  const parsed = configSchema.safeParse(value);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "config"}: ${issue.message}`,
    );
    return { ok: false, errors };
  }

  return { ok: true, config: parsed.data as InvoiceTemplateConfig };
}

/** Structural helper used by the dashboard: which section types are present. */
export function sectionTypesOf(config: InvoiceTemplateConfig): InvoiceSection["type"][] {
  return config.sections.map((section) => section.type);
}

/** Whether a section with the given type exists and is visible in the config. */
export function isSectionVisible(
  config: InvoiceTemplateConfig,
  type: InvoiceSection["type"],
): boolean {
  return config.sections.some((section) => section.type === type && section.visible);
}
