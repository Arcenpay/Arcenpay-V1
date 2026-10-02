import { describe, it, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { ArcenPayAgent } from "../src/agent";

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

describe("ArcenPayAgent — Solana", () => {
  it("constructs on a Solana chain and exposes the base58 address", () => {
    const keypair = Keypair.generate();
    const agent = new ArcenPayAgent({
      chainId: 9_100_001,
      privateKey: encodeBase58(keypair.secretKey),
      rpcUrl: "https://api.devnet.solana.com",
    });
    expect(agent.address).toBe(keypair.publicKey.toBase58());
    expect(agent.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("accepts a JSON-array secret key", () => {
    const keypair = Keypair.generate();
    const agent = new ArcenPayAgent({
      chainId: 9_100_001,
      privateKey: JSON.stringify(Array.from(keypair.secretKey)),
      rpcUrl: "https://api.devnet.solana.com",
    });
    expect(agent.address).toBe(keypair.publicKey.toBase58());
  });
});
