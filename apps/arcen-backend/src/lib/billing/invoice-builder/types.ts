/**
 * Invoice Builder — declarative invoice template config.
 *
 * V1 layouts are ordered section lists interpreted by the pdf-lib template
 * renderer (`invoice-builder/renderer.ts`). Only allowlisted sections, values
 * and enums are accepted — validation lives in `invoice-builder/schema.ts`.
 *
 * The config is stored as `InvoiceTemplate.config` (Json) and snapshotted
 * onto every issued invoice (`Invoice.templateSnapshot`) so historically
 * issued documents never change when a provider edits their template.
 */

export const INVOICE_BUILDER_SCHEMA_VERSION = 1 as const;

export const INVOICE_TEMPLATE_MAX_BYTES = 64 * 1024; // 64 KB, mirrors reference layout limit

export type InvoiceFontFamily = "helvetica" | "courier";
export type InvoiceSectionAlign = "left" | "center";

/**
 * Ordered, non-duplicated section list.
 *  - `header`        — document title + provider name + optional logo
 *  - `metadata`      — invoice/receipt numbers and dates
 *  - `addresses`     — "From" (provider) and "Bill to" (customer) side by side
 *  - `itemsTable`    — line-item breakdown
 *  - `totals`        — subtotal / tax / total / amount due or paid
 *  - `footer`        — payment method, support details, custom note
 */
export type InvoiceSectionType =
  | "header"
  | "metadata"
  | "addresses"
  | "itemsTable"
  | "totals"
  | "footer";

export interface InvoiceHeaderSection {
  type: "header";
  visible: boolean;
  showLogo: boolean;
  /** Object key under INVOICE_STORAGE_DIR, e.g. `assets/{teamId}/logo.png`. */
  logoObjectKey: string | null;
  /** Static title override. `null` resolves to "Invoice"/"Receipt" by kind. */
  title: string | null;
  align: InvoiceSectionAlign;
  /** Draws a colored rule under the header. */
  accentBar: boolean;
}

export interface InvoiceMetadataFieldOptions {
  showInvoiceNumber: boolean;
  showIssueDate: boolean;
  showDueDate: boolean;
  showReceiptNumber: boolean;
  showPaidDate: boolean;
}

export interface InvoiceMetadataSection extends InvoiceMetadataFieldOptions {
  type: "metadata";
  visible: boolean;
  columns: 1 | 2;
}

export interface InvoiceAddressesSection {
  type: "addresses";
  visible: boolean;
  showFrom: boolean;
  showBillTo: boolean;
  fromTitle: string;
  billToTitle: string;
}

export interface InvoiceItemsTableSection {
  type: "itemsTable";
  visible: boolean;
  /** Column width fractions (sum <= 1). */
  columnWidths: {
    description: number;
    qty: number;
    unitPrice: number;
    amount: number;
  };
}

export interface InvoiceTotalsSection {
  type: "totals";
  visible: boolean;
  showSubtotal: boolean;
  showTax: boolean;
  showTotal: boolean;
  showAmountPaid: boolean;
  showAmountDue: boolean;
}

export interface InvoiceFooterSection {
  type: "footer";
  visible: boolean;
  showPaymentMethod: boolean;
  showSupport: boolean;
  /** Optional free-form note printed above the payment/support lines. */
  note: string | null;
}

export type InvoiceSection =
  | InvoiceHeaderSection
  | InvoiceMetadataSection
  | InvoiceAddressesSection
  | InvoiceItemsTableSection
  | InvoiceTotalsSection
  | InvoiceFooterSection;

export interface InvoiceTemplateStyle {
  /** Headings, title, bold amounts. Hex `#RRGGBB`. */
  primaryColor: string;
  /** Accent rule + watermarks. Hex `#RRGGBB`. */
  accentColor: string;
  /** Secondary label text. Hex `#RRGGBB`. */
  mutedColor: string;
  /** Table rules + container border. Hex `#RRGGBB`. */
  borderColor: string;
  /** Page background. Hex `#RRGGBB`. */
  backgroundColor: string;
  /** Whitelisted standard PDF font. */
  fontFamily: InvoiceFontFamily;
  /** Base body font size in points. */
  baseFontSize: number;
  /** Max logo height in points when drawn. */
  logoMaxHeight: number;
  pageOrientation: "portrait" | "landscape";
}

export interface InvoiceWatermarkConfig {
  /** Diagonal watermark shown on paid documents, e.g. "PAID". Null = off. */
  onPaid: string | null;
  /** Diagonal watermark shown on overdue issues, e.g. "OVERDUE". Null = off. */
  onOverdue: string | null;
}

export interface InvoiceTemplateConfig {
  schemaVersion: typeof INVOICE_BUILDER_SCHEMA_VERSION;
  meta: {
    name: string;
    description?: string;
  };
  style: InvoiceTemplateStyle;
  sections: InvoiceSection[];
  watermark: InvoiceWatermarkConfig;
}
