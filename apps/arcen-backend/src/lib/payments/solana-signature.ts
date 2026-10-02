// ============================================================
//  ArcenPay Backend — Solana signature verification
//
//  Verifies an ed25519 signature produced by a Solana wallet
//  (Phantom, Solflare, …) over a UTF-8 message.
//
//  Solana uses ed25519 with base58-encoded public keys and
//  signatures. Verification uses `tweetnacl` (the same library
//  @solana/web3.js uses internally) so behaviour matches wallet
//  implementations exactly.
// ============================================================

import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Bitcoin-alphabet base58 (used by Solana for addresses + signatures).
// Decoded inline to avoid depending on an untyped `bs58` package.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i += 1) {
    map[BASE58_ALPHABET[i]] = i;
  }
  return map;
})();

/** Decodes a base58 string to bytes. Returns null on invalid input. */
function decodeBase58(value: string): Uint8Array | null {
  if (!value) return null;
  let num = 0n;
  for (const char of value) {
    const digit = BASE58_LOOKUP[char];
    if (digit === undefined) return null;
    num = num * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  // Preserve leading zero bytes (each leading '1' encodes one 0x00 byte).
  for (let i = 0; i < value.length && value[i] === "1"; i += 1) {
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** True if `value` looks like a base58 Solana address (validated against the curve). */
export function isValidSolanaAddress(value: unknown): value is string {
  if (typeof value !== "string" || !SOLANA_ADDRESS_REGEX.test(value)) return false;
  try {
    // PublicKey construction validates the point is on the ed25519 curve
    // and rejects addresses of the wrong length.
    // eslint-disable-next-line no-new
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Verifies a Solana `signMessage` signature.
 *
 * @param message  The exact UTF-8 message the wallet signed.
 * @param signatureBase58  Base58-encoded 64-byte ed25519 signature.
 * @param address  Base58-encoded 32-byte ed25519 public key.
 */
export function verifySolanaSignature(input: {
  message: string;
  signatureBase58: string;
  address: string;
}): boolean {
  try {
    if (!isValidSolanaAddress(input.address)) return false;
    const signature = decodeBase58(input.signatureBase58.trim());
    if (!signature || signature.length !== 64) return false;
    const publicKey = new PublicKey(input.address).toBytes();
    return nacl.sign.detached.verify(
      Buffer.from(input.message, "utf8"),
      signature,
      publicKey,
    );
  } catch {
    return false;
  }
}
