import type { InvoiceTemplateConfig } from "./types.js";

/**
 * Stock "Classic" template — the starting point for providers who open the
 * invoice builder. It intentionally mirrors the appearance of the legacy
 * (pre-builder) invoice layout: bordered A4 page, dark headings, muted labels,
 * side-by-side From/Bill-to block, tabular line items and a totals block.
 *
 * Free-tier invoices (no template configured) keep rendering through the
 * legacy renderer unchanged — this template is the visual baseline for
 * Plus/Pro providers who activate the builder.
 */
export function buildDefaultInvoiceTemplateConfig(): InvoiceTemplateConfig {
  return {
    schemaVersion: 1,
    meta: {
      name: "Classic",
      description: "Default ArcenPay layout — dark headings, bordered page.",
    },
    style: {
      primaryColor: "#161c24",
      accentColor: "#161c24",
      mutedColor: "#596373",
      borderColor: "#e6ebf2",
      backgroundColor: "#ffffff",
      fontFamily: "helvetica",
      baseFontSize: 11,
      logoMaxHeight: 56,
      pageOrientation: "portrait",
    },
    sections: [
      {
        type: "header",
        visible: true,
        showLogo: false,
        logoObjectKey: null,
        title: null,
        align: "left",
        accentBar: false,
      },
      {
        type: "metadata",
        visible: true,
        columns: 2,
        showInvoiceNumber: true,
        showIssueDate: true,
        showDueDate: true,
        showReceiptNumber: true,
        showPaidDate: true,
      },
      {
        type: "addresses",
        visible: true,
        showFrom: true,
        showBillTo: true,
        fromTitle: "From",
        billToTitle: "Bill to",
      },
      {
        type: "itemsTable",
        visible: true,
        columnWidths: {
          description: 0.55,
          qty: 0.1,
          unitPrice: 0.17,
          amount: 0.18,
        },
      },
      {
        type: "totals",
        visible: true,
        showSubtotal: true,
        showTax: true,
        showTotal: true,
        showAmountPaid: true,
        showAmountDue: true,
      },
      {
        type: "footer",
        visible: true,
        showPaymentMethod: true,
        showSupport: true,
        note: null,
      },
    ],
    watermark: {
      onPaid: "PAID",
      onOverdue: "OVERDUE",
    },
  };
}
