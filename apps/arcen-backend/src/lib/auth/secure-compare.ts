/**
 * Constant-time secret comparison.
 *
 * SECURITY: `a === b` on secrets is a timing oracle. V8 short-circuits string
 * equality on the first differing byte, so an attacker who can measure response
 * latency can recover a shared secret (facilitator bearer token, admin secret,
 * webhook signing secret) byte by byte. Node's `crypto.timingSafeEqual` fixes
 * the comparison itself but throws when the buffers differ in length, and a
 * length check leaks the secret's length.
 *
 * Both values are therefore SHA-256 digested first. That yields two fixed
 * 32-byte buffers, so:
 *   - the comparison is always constant time, and
 *   - no information about the secret's length is leaked.
 *
 * This is the ONLY sanctioned way to compare a secret in this codebase.
 * Do NOT reintroduce `===`/`includes()` comparisons for credentials.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export function secureCompare(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") {
    return false;
  }
  // Empty expected secret must never match (fail-closed on misconfiguration).
  if (expected.length === 0 || provided.length === 0) {
    return false;
  }

  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();

  return timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Extracts a single cookie value from a raw `Cookie` header without substring
 * matching.
 *
 * SECURITY: `cookieHeader.includes("name=" + secret)` is both incorrect (it
 * matches a prefix of a longer value) and a timing oracle. This parses the
 * header into name/value pairs and returns the exact value for `name`.
 */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}
