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
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return "0.00";
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

/**
 * Normalizes an x402 payment amount to the decimal USDC string used in
 * Stellar x402 signing/verification.
 *
 * - A decimal string ("0.01") is kept verbatim.
 * - An atomic-unit integer string ("10000") is converted to decimal ("0.01").
 * - bigint/number inputs are treated as atomic units and converted.
 *
 * 1 USDC = 1_000_000 micros (6 decimals). Both the @arcenpay/agent signer and
 * the @arcenpay/node verifier MUST use this same function so the signed
 * message text matches exactly.
 */
export function normalizeX402AmountToDecimal(
  value: unknown,
  fallbackAtomic?: bigint,
): string {
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    // A decimal-form string contains a "." (e.g. "0.01", "1.5") → keep verbatim.
    // The x402 middleware advertises maxAmountRequired in ATOMIC units as a
    // bare integer string ("10000"), so a pure-integer string is treated as
    // atomic and converted to its decimal form ("0.01"). Both the agent
    // signer and node verifier MUST apply this same rule so the signed
    // message text matches.
    if (/^\d+\.\d+$/.test(trimmed)) return trimmed;
    try {
      return atomicToDecimal(BigInt(trimmed));
    } catch {
      return fallbackAtomic !== undefined
        ? atomicToDecimal(fallbackAtomic)
        : "0";
    }
  }
  if (typeof value === "bigint") return atomicToDecimal(value);
  if (typeof value === "number" && Number.isFinite(value)) {
    return atomicToDecimal(BigInt(Math.trunc(value)));
  }
  return fallbackAtomic !== undefined
    ? atomicToDecimal(fallbackAtomic)
    : "0";
}

function atomicToDecimal(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fracRaw = (atomic % 1_000_000n).toString().padStart(6, "0");
  if (fracRaw === "000000") return whole.toString();
  // Strip trailing fractional zeros for a canonical decimal string:
  // 10000 micros → "0.01" (not "0.010000").
  const frac = fracRaw.replace(/0+$/, "");
  return `${whole}.${frac}`;
}

