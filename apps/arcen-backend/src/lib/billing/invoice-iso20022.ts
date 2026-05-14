import {
  getCustomerAddressLines,
  getPaymentMethodLabel,
  getProviderAddressLines,
  getProviderDisplayName,
  loadInvoiceBillingContext,
} from "./invoice-context.js";

const ISO_20022_REMT_NAMESPACE =
  "urn:iso:std:iso:20022:tech:xsd:remt.001.001.07";
const REMITTANCE_MESSAGE_TYPE = "remt.001.001.07";

const TOKEN_TO_ISO_4217: Record<string, string> = {
  AUDC: "AUD",
  DAI: "USD",
  EURC: "EUR",
  GYEN: "JPY",
  JPYC: "JPY",
  PYUSD: "USD",
  USDC: "USD",
  USDT: "USD",
  XSGD: "SGD",
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function sanitizeIdentifier(value: string, fallback: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 35);
  return sanitized || fallback;
}

function normalizeText(value: string, maxLength = 140): string {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function xmlNode(tag: string, value: string | null | undefined): string {
  if (!value) return "";
  return `<${tag}>${escapeXml(value)}</${tag}>`;
}

function xmlAmount(tag: string, amount: string, currencyCode: string): string {
  return `<${tag} Ccy="${escapeXml(currencyCode)}">${escapeXml(amount)}</${tag}>`;
}

function resolveCurrencyProfile(currency: string) {
  const normalized = currency.trim().toUpperCase();
  return {
    originalCurrency: normalized,
    currencyCode: TOKEN_TO_ISO_4217[normalized] ?? normalized,
  };
}

export async function generateInvoiceIso20022(
  teamId: string,
  invoiceId: string,
): Promise<{
  filename: string;
  xml: string;
  messageType: string;
  namespace: string;
}> {
  const context = await loadInvoiceBillingContext(teamId, invoiceId);
  if (!context) {
    throw new Error("Invoice not found");
  }

  const { invoice } = context;
  const providerName = getProviderDisplayName(context);
  const providerAddress = getProviderAddressLines(context).join(" | ");
  const customerAddress = getCustomerAddressLines(context).join(" | ");
  const paymentMethodLabel = getPaymentMethodLabel(context);
  const issuedDate = formatDateOnly(invoice.issuedAt ?? invoice.createdAt);
  const dueDate = formatDateOnly(invoice.dueAt);
  const paidDate = formatDateOnly(invoice.paidAt);
  const paymentDate = formatDateOnly(context.payment?.settledAt ?? invoice.paidAt);
  const invoiceNumber = invoice.number?.trim() || invoice.id;
  const endToEndId = sanitizeIdentifier(invoiceNumber, `INV${invoice.id.slice(-10)}`);
  const instructionId = sanitizeIdentifier(invoice.id, `ARC${invoice.id.slice(-10)}`);
  const txId = sanitizeIdentifier(
    context.payment?.txHash?.trim() || invoice.externalRef?.trim() || invoice.id,
    instructionId,
  );
  const messageId = sanitizeIdentifier(
    `ARCEN-${invoice.id.slice(-24)}`,
    `ARCEN${invoice.id.slice(-10)}`,
  );

  const total = invoice.total.toString();
  const amountPaid = invoice.amountPaid.toString();
  const amountOutstanding = invoice.amountOutstanding.toString();
  const subtotal = invoice.subtotal.toString();
  const taxTotal = invoice.taxTotal.toString();
  const amountPaidValue = Number(amountPaid);
  const amountOutstandingValue = Number(amountOutstanding);
  const { currencyCode, originalCurrency } = resolveCurrencyProfile(
    invoice.currency,
  );
  const lineDescriptions = invoice.lineItems
    .map((line, index) =>
      normalizeText(
        `Line ${index + 1}: ${line.description} x${line.quantity} total ${line.lineTotal.toString()} ${originalCurrency}`,
      ),
    )
    .slice(0, 6);

  const additionalRemittanceInfo = [
    normalizeText(
      [
        issuedDate ? `Invoice issued ${issuedDate}` : null,
        dueDate ? `due ${dueDate}` : null,
        paidDate ? `paid ${paidDate}` : null,
        paymentDate && paymentDate !== paidDate
          ? `settled ${paymentDate}`
          : null,
      ]
        .filter(Boolean)
        .join(", "),
    ),
    normalizeText(
      [
        providerAddress ? `Provider: ${providerAddress}` : null,
        customerAddress ? `Customer: ${customerAddress}` : null,
      ]
        .filter(Boolean)
        .join(" | "),
    ),
    normalizeText(
      [
        `Payment method: ${paymentMethodLabel}`,
        originalCurrency !== currencyCode
          ? `Original token ${originalCurrency} mapped to ISO 4217 currency ${currencyCode} for ISO 20022 compatibility`
          : null,
      ]
        .filter(Boolean)
        .join(" | "),
    ),
  ].filter(Boolean);

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<Document xmlns="${ISO_20022_REMT_NAMESPACE}">`,
    "  <RmtAdvc>",
    "    <GrpHdr>",
    `      ${xmlNode("MsgId", messageId)}`,
    `      ${xmlNode("CreDtTm", new Date().toISOString())}`,
    "      <InitgPty>",
    `        ${xmlNode("Nm", providerName)}`,
    "      </InitgPty>",
    "    </GrpHdr>",
    "    <RmtInf>",
    `      ${xmlNode("RmtId", endToEndId)}`,
    lineDescriptions.map((line) => `      ${xmlNode("Ustrd", line)}`).join("\n"),
    "      <Strd>",
    "        <RfrdDocInf>",
    `          ${xmlNode("Nb", invoiceNumber)}`,
    `          ${issuedDate ? xmlNode("RltdDt", issuedDate) : ""}`,
    "        </RfrdDocInf>",
    `        <RfrdDocAmt>${xmlAmount(
      "DuePyblAmt",
      amountOutstandingValue > 0 ? amountOutstanding : total,
      currencyCode,
    )}</RfrdDocAmt>`,
    `        ${xmlAmount(
      "RmtdAmt",
      amountPaidValue > 0 ? amountPaid : total,
      currencyCode,
    )}`,
    additionalRemittanceInfo
      .slice(0, 3)
      .map((line) => `        ${xmlNode("AddtlRmtInf", line)}`)
      .join("\n"),
    "      </Strd>",
    "      <OrgnlPmtInf>",
    "        <Refs>",
    `          ${xmlNode("InstrId", instructionId)}`,
    `          ${xmlNode("EndToEndId", endToEndId)}`,
    `          ${xmlNode("TxId", txId)}`,
    "        </Refs>",
    `        ${xmlNode("InstrId", instructionId)}`,
    `        ${xmlNode("EndToEndId", endToEndId)}`,
    `        ${xmlNode("TxId", txId)}`,
    `        <Amt>${xmlAmount("InstdAmt", total, currencyCode)}</Amt>`,
    "        <Dbtr>",
    `          ${xmlNode("Nm", context.customerName || invoice.customerEmail || "Customer")}`,
    "        </Dbtr>",
    "        <Cdtr>",
    `          ${xmlNode("Nm", providerName)}`,
    "        </Cdtr>",
    "      </OrgnlPmtInf>",
    "      <Refs>",
    `        ${xmlNode("InstrId", instructionId)}`,
    `        ${xmlNode("EndToEndId", endToEndId)}`,
    `        ${xmlNode("TxId", txId)}`,
    "      </Refs>",
    `      ${xmlNode("InstrId", instructionId)}`,
    `      ${xmlNode("EndToEndId", endToEndId)}`,
    `      ${xmlNode("TxId", txId)}`,
    `      <Amt>${xmlAmount("InstdAmt", total, currencyCode)}</Amt>`,
    amountOutstandingValue > 0
      ? `      ${xmlNode(
          "Ustrd",
          normalizeText(
            `Amount outstanding: ${amountOutstanding} ${originalCurrency}. Subtotal ${subtotal} ${originalCurrency}, tax ${taxTotal} ${originalCurrency}.`,
          ),
        )}`
      : "",
    "    </RmtInf>",
    "  </RmtAdvc>",
    "</Document>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    filename: `${invoiceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}-${REMITTANCE_MESSAGE_TYPE}.xml`,
    xml,
    messageType: REMITTANCE_MESSAGE_TYPE,
    namespace: ISO_20022_REMT_NAMESPACE,
  };
}
