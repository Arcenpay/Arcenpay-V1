import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { Keypair } from "@solana/web3.js";
import {
  isValidSolanaAddress,
  verifySolanaSignature,
} from "../../../src/lib/payments/solana-signature";

// Minimal base58 encoder (Bitcoin alphabet) so the test doesn't need bs58.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function encodeBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let out = "";
  while (num > 0n) {
    out = ALPHABET[Number(num % 58n)] + out;
    num /= 58n;
  }
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) out = "1" + out;
  return out;
}

describe("isValidSolanaAddress", () => {
  it("accepts a real Solana public key", () => {
    const kp = Keypair.generate();
    expect(isValidSolanaAddress(kp.publicKey.toBase58())).toBe(true);
  });

  it("rejects EVM addresses and garbage", () => {
    expect(isValidSolanaAddress("0xabcdef1234567890abcdef1234567890abcdef12")).toBe(false);
    expect(isValidSolanaAddress("")).toBe(false);
    expect(isValidSolanaAddress("not-a-solana-address")).toBe(false);
    expect(isValidSolanaAddress(null)).toBe(false);
  });
});

describe("verifySolanaSignature", () => {
  it("verifies a valid ed25519 signMessage signature", () => {
    const kp = Keypair.generate();
    const message = `ArcenPay Solana Sign-In\n\nAddress: ${kp.publicKey.toBase58()}\nNonce: abc`;
    const signature = nacl.sign.detached(
      Buffer.from(message, "utf8"),
      kp.secretKey,
    );
    const ok = verifySolanaSignature({
      message,
      signatureBase58: encodeBase58(signature),
      address: kp.publicKey.toBase58(),
    });
    expect(ok).toBe(true);
  });

  it("rejects a signature for a different message", () => {
    const kp = Keypair.generate();
    const signature = nacl.sign.detached(Buffer.from("original"), kp.secretKey);
    const ok = verifySolanaSignature({
      message: "tampered",
      signatureBase58: encodeBase58(signature),
      address: kp.publicKey.toBase58(),
    });
    expect(ok).toBe(false);
  });

  it("rejects an invalid signature encoding", () => {
    const kp = Keypair.generate();
    expect(
      verifySolanaSignature({
        message: "x",
        signatureBase58: "not-base58-!!!",
        address: kp.publicKey.toBase58(),
      }),
    ).toBe(false);
  });
});
