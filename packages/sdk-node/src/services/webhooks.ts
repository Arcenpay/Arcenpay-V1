import { createHmac, timingSafeEqual } from "crypto";

/**
 * Standalone helper for verifying incoming ArcenPay webhook signatures.
 *
 * @param body      - Raw request body string (before any JSON.parse)
 * @param signature - Value from the `X-ArcenPay-Signature` request header
 * @param secret    - Shared HMAC signing secret configured on the provider's webhook endpoint
 *
 * SECURITY NOTES
 *  - The comparison is constant-time, and both digests are equal-length, so the
 *    only timing signal is the header's own length.
 *  - Inputs are type-checked: a malformed header must return `false`, never
 *    throw. Throwing inside a provider's webhook handler turns a single crafted
 *    request into a 500/crash (denial of service) rather than a clean 401.
 *  - Always pass the RAW body. Re-serializing parsed JSON changes whitespace and
 *    key order, which breaks the HMAC (and tempts callers to skip verification).
 */
export function verifyWebhookSignature(
  body: unknown,
  signature: unknown,
  secret: unknown,
): boolean {
  if (typeof body !== "string") return false;
  if (typeof signature !== "string") return false;
  if (typeof secret !== "string") return false;

  const normalizedSecret = secret.trim();
  const normalizedSignature = signature
    .trim()
    .replace(/^sha256=/i, "")
    .toLowerCase();

  if (!normalizedSecret) return false;
  if (!/^[0-9a-f]{64}$/.test(normalizedSignature)) return false;

  const expected = Buffer.from(
    createHmac("sha256", normalizedSecret).update(body).digest("hex"),
    "hex",
  );
  const received = Buffer.from(normalizedSignature, "hex");

  return (
    expected.length === received.length &&
    timingSafeEqual(expected, received)
  );
}
