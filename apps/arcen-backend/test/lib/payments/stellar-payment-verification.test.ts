import { describe, it, afterEach, expect } from "vitest";

import { normalizeStellarTxHash, verifyStellarPayment } from "../../../src/lib/payments/stellar-payment-verification.js";
import { normalizeTxHashForFamily } from "../../../src/lib/payments/onchain-payment-verification.js";

const TESTNET_CHAIN_ID = 9_000_001;
// Circle USDC testnet issuer.
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const { Keypair } = await import("@stellar/stellar-sdk");
const RECIPIENT = Keypair.random().publicKey();
const SENDER = Keypair.random().publicKey();
const TX_HASH = "a".repeat(64);

type FetchMock = (url: string | URL | Request) => Promise<Response>;

function mockSoroban(status: "SUCCESS" | "NOT_FOUND" | "FAILED") {
  const mock: FetchMock = async (url: string | URL | Request) => {
    const href = String(url);
    if (href.startsWith("https://soroban-testnet.stellar.org")) {
      return new Response(
        JSON.stringify({ result: { status } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (href.includes("/transactions/")) {
      const records = [
        {
          type: "payment",
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER,
          from: SENDER,
          to: RECIPIENT,
          amount: "10.0000000",
        },
      ];
      return new Response(
        JSON.stringify({ _embedded: { records } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (href.includes("/assets?")) {
      return new Response(
        JSON.stringify({
          _embedded: {
            records: [
              { asset_code: "USDC", asset_issuer: USDC_ISSUER },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };
  (globalThis as any).fetch = mock;
}

afterEach(() => {
  delete (globalThis as any).fetch;
});

describe("normalizeStellarTxHash", () => {
  it("accepts a bare 64-hex hash", () => {
    expect(normalizeStellarTxHash(TX_HASH)).toBe(TX_HASH);
  });
  it("strips an 0x prefix", () => {
    expect(normalizeStellarTxHash(`0x${TX_HASH}`)).toBe(TX_HASH);
  });
  it("rejects invalid hashes", () => {
    expect(normalizeStellarTxHash("abc")).toBeNull();
    expect(normalizeStellarTxHash("")).toBeNull();
    expect(normalizeStellarTxHash(null)).toBeNull();
  });
});

describe("normalizeTxHashForFamily", () => {
  it("keeps EVM hashes with 0x prefix", () => {
    const evmHash = `0x${TX_HASH}`;
    expect(normalizeTxHashForFamily(evmHash, 84532)).toBe(evmHash);
  });
  it("accepts Stellar 64-hex hashes", () => {
    expect(normalizeTxHashForFamily(TX_HASH, TESTNET_CHAIN_ID)).toBe(TX_HASH);
  });
  it("strips 0x prefix on Stellar", () => {
    expect(
      normalizeTxHashForFamily(`0x${TX_HASH}`, TESTNET_CHAIN_ID),
    ).toBe(TX_HASH);
  });
  it("rejects invalid hashes for a Stellar chain", () => {
    expect(normalizeTxHashForFamily("xyz", TESTNET_CHAIN_ID)).toBeNull();
  });
});

describe("verifyStellarPayment", () => {
  it("verifies a successful USDC payment with matching amount", async () => {
    mockSoroban("SUCCESS");
    const result = await verifyStellarPayment({
      chainId: TESTNET_CHAIN_ID,
      txHash: TX_HASH,
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 10_000_000n,
      recipientWallet: RECIPIENT,
      senderWallet: SENDER,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.senderWallet).toBe(SENDER);
      expect(result.recipientWallet).toBe(RECIPIENT);
      expect(result.amountMicros).toBe(10_000_000n);
    }
  });

  it("rejects a payment to the wrong recipient", async () => {
    mockSoroban("SUCCESS");
    const result = await verifyStellarPayment({
      chainId: TESTNET_CHAIN_ID,
      txHash: TX_HASH,
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 10_000_000n,
      recipientWallet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects a payment with a mismatched amount", async () => {
    mockSoroban("SUCCESS");
    const result = await verifyStellarPayment({
      chainId: TESTNET_CHAIN_ID,
      txHash: TX_HASH,
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 99_000_000n,
      recipientWallet: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects a non-SUCCESS Soroban status", async () => {
    mockSoroban("FAILED");
    const result = await verifyStellarPayment({
      chainId: TESTNET_CHAIN_ID,
      txHash: TX_HASH,
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 10_000_000n,
      recipientWallet: RECIPIENT,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid tx hash", async () => {
    mockSoroban("SUCCESS");
    const result = await verifyStellarPayment({
      chainId: TESTNET_CHAIN_ID,
      txHash: "not-a-hash",
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 10_000_000n,
      recipientWallet: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("rejects non-Stellar chains", async () => {
    const result = await verifyStellarPayment({
      chainId: 84532,
      txHash: TX_HASH,
      acceptedToken: USDC_ISSUER,
      expectedAmountMicros: 10_000_000n,
      recipientWallet: RECIPIENT,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });
});
