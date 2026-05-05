import type { InvoiceSummary, ComponentInvoiceSummary } from "./types";

const STABLECOIN_TO_ISO: Record<string, string> = {
  USDC: "USD",
  USDT: "USD",
  DAI: "USD",
  BUSD: "USD",
  GUSD: "USD",
  USDP: "USD",
  TUSD: "USD",
  FRAX: "USD",
  LUSD: "USD",
  SUSD: "USD",
  EURC: "EUR",
  EURT: "EUR",
};

export function toISOCurrencyCode(currency: string | undefined | null): string {
  if (!currency) return "USD";
  return STABLECOIN_TO_ISO[currency.toUpperCase()] ?? currency.toUpperCase();
}

export function isStablecoinCode(currency: string): boolean {
  return currency.toUpperCase() in STABLECOIN_TO_ISO;
}

export function formatCurrency(
  amount: string | number | bigint,
  currency: string = "USD",
  options?: { showCode?: boolean; locale?: string },
): string {
  const numeric =
    typeof amount === "bigint" ? Number(amount) : Number(amount);
  if (!Number.isFinite(numeric)) return String(amount);

  const isoCode = toISOCurrencyCode(currency);

  try {
    const formatted = new Intl.NumberFormat(options?.locale ?? "en-US", {
      style: "currency",
      currency: isoCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);

    if (options?.showCode && isStablecoinCode(currency)) {
      return `${formatted} ${currency.toUpperCase()}`;
    }
    return formatted;
  } catch {
    return `${numeric.toFixed(2)} ${currency}`;
  }
}

export function formatUsdc(amount: bigint | number | string): string {
  const n = typeof amount === "bigint" ? Number(amount) : Number(amount);
  const dollars = n / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(dollars);
}

export function formatInvoiceTotal(
  invoice: InvoiceSummary | ComponentInvoiceSummary,
): string {
  return formatCurrency(invoice.total, invoice.currency);
}
