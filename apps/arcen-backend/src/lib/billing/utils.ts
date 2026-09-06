import { YEARLY_INTERVAL } from "@arcenpay/internal-core";

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeWallet(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // EVM addresses (0x...) are hex and case-insensitive; normalize to lowercase.
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return trimmed.toLowerCase();
  }
  // Non-EVM addresses (e.g. Stellar G... account or C... contract base32) are case-sensitive; preserve case.
  return trimmed;
}

export function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function deriveBillingPeriodFromInterval(
  billingInterval: unknown,
): "monthly" | "annual" {
  return typeof billingInterval === "number" && billingInterval >= YEARLY_INTERVAL
    ? "annual"
    : "monthly";
}
