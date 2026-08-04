import { YEARLY_INTERVAL } from "@arcenpay/internal-core";

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeWallet(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Stellar addresses are case-sensitive (base32); preserve mixed-case.
  if (trimmed.startsWith("G") && trimmed.length === 56) return trimmed;
  return trimmed.toLowerCase();
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
