/**
 * Trusted client-IP resolution.
 *
 * Extracted from `arcjet.ts` so rate limiting, audit records and logs can resolve
 * a client IP WITHOUT importing the Arcjet SDK (and without triggering its
 * module-load client construction in tests).
 *
 * SECURITY: `X-Forwarded-For` is client-writable. Each proxy in the chain
 * APPENDS the address of the peer it received the request from, so only the last
 * `TRUSTED_PROXY_HOPS` entries were written by infrastructure we control. With
 * the default of 1 the RIGHTMOST entry is authoritative; everything to its left
 * is attacker-controlled and must never be used as a rate-limit key.
 */

import { isIP } from "node:net";

export const TRUSTED_PROXY_HOPS: number = (() => {
  const raw = process.env.TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
})();

/** Strict IP validation so garbage can never reach a fingerprint or key. */
export function isValidIp(value: string | undefined | null): value is string {
  if (!value) return false;
  return isIP(value) !== 0;
}

/**
 * Resolves the real client IP from the forwarded chain using the trusted-proxy
 * hop count. Returns `null` when no trustworthy address can be determined.
 */
export function extractTrustedClientIp(
  get: (name: string) => string | null,
): string | null {
  const forwarded = get("x-forwarded-for");
  if (forwarded) {
    const chain = forwarded
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (chain.length > 0) {
      // Walk from the right: skip the entries appended by our own proxies.
      const index = chain.length - TRUSTED_PROXY_HOPS;
      const candidate = index >= 0 ? chain[index] : undefined;
      if (isValidIp(candidate)) return candidate;
    }
  }

  // `x-real-ip` / `cf-connecting-ip` are only meaningful when the edge
  // overwrites them, and only consulted when they validate as a real IP.
  const realIp = get("x-real-ip")?.trim();
  if (isValidIp(realIp)) return realIp;

  const cfIp = get("cf-connecting-ip")?.trim();
  if (isValidIp(cfIp)) return cfIp;

  return null;
}

/**
 * Public wrapper over the trusted-proxy IP resolution.
 *
 * Use this anywhere an audit record, rate-limit key, or log line needs a client
 * IP. Never read `x-forwarded-for` directly at a call site — the leftmost entry
 * is attacker-supplied.
 */
export function resolveTrustedClientIp(headers: {
  get(name: string): string | null | undefined;
}): string | null {
  return extractTrustedClientIp((name) => headers.get(name) ?? null);
}
