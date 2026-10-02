// ============================================================
//  Dashboard — browser-safe Solana helpers
//
//  The dashboard cannot import `@arcenpay/internal-core/solana`
//  (Node-only: it uses Buffer + node:crypto). These are the small
//  primitives the browser surfaces need.
// ============================================================

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Encodes bytes to a Bitcoin-alphabet base58 string (no Buffer dependency). */
export function encodeBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) {
    out = BASE58_ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) out = "1" + out;
  return out;
}
