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


/**
 * Breaks a single over-long token (e.g. a wallet address) into name-safe chunks
 * so it stays inside a PDF text column instead of overflowing the page edge.
 */
export function splitLongToken(text: string, maxLength = 32): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return [trimmed];
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += maxLength) {
    chunks.push(trimmed.slice(i, i + maxLength));
  }
  return chunks;
}

/**
 * Word wraps text to a column width, additionally chunking any single token
 * longer than `maxLength` (wallets, tokens) onto its own lines.
 */
export function wrapColumnText(text: string, maxLength = 32): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(...splitLongToken(word, maxLength));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [text];
}
