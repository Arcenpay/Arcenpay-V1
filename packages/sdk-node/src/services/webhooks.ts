import { createHmac, timingSafeEqual } from "crypto";

/**
 * Standalone helper for verifying incoming ArcenPay webhook signatures.
 *
 * @param body      - Raw request body string (before any JSON.parse)
 * @param signature - Value from the `X-ArcenPay-Signature` request header
 * @param secret    - Shared HMAC signing secret configured on the provider's webhook endpoint
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
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
