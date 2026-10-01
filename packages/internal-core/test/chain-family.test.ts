import { describe, expect, it } from "vitest";
import {
  normalizeWalletForChain,
  getChainFamily,
  isSolanaChain,
  isSolanaChainId,
  isEvmChain,
  isValidAddressForChain,
  isValidTxHashForChain,
  getSolanaRpcUrl,
  unsetAddressForFamily,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
} from "../src/chain-family";
import { normalizeX402AmountToDecimal } from "../src/format";

describe("normalizeWalletForChain", () => {
  it("lowercases EVM addresses", () => {
    expect(normalizeWalletForChain("0xABCdef1234567890AbCdEf1234567890aBcDef12", 84532)).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
  });

  it("preserves Stellar G… addresses exactly (base32 is case-sensitive)", () => {
    const stellar = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(normalizeWalletForChain(stellar, 9_000_001)).toBe(stellar);
  });

  it("preserves Stellar mainnet addresses exactly", () => {
    const stellar = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5REQK4DVZWA";
    expect(normalizeWalletForChain(stellar, 9_000_000)).toBe(stellar);
  });

  it("trims whitespace", () => {
    expect(normalizeWalletForChain("  0xABCdef1234567890AbCdEf1234567890aBcDef12  ", 84532)).toBe(
      "0xabcdef1234567890abcdef1234567890abcdef12",
    );
    expect(normalizeWalletForChain("  GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5  ", 9_000_001)).toBe(
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    );
  });

  it("returns null for empty / non-string values", () => {
    expect(normalizeWalletForChain("", 84532)).toBeNull();
    expect(normalizeWalletForChain("   ", 84532)).toBeNull();
    expect(normalizeWalletForChain(null, 84532)).toBeNull();
    expect(normalizeWalletForChain(undefined, 84532)).toBeNull();
  });

  it("preserves Solana base58 addresses exactly (case-sensitive)", () => {
    const solana = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(normalizeWalletForChain(solana, SOLANA_MAINNET_CHAIN_ID)).toBe(solana);
    expect(normalizeWalletForChain(solana, SOLANA_DEVNET_CHAIN_ID)).toBe(solana);
  });
});

describe("Solana chain identity", () => {
  it("assigns synthetic chainIds in the reserved 9_100_000+ range", () => {
    expect(SOLANA_MAINNET_CHAIN_ID).toBe(9_100_000);
    expect(SOLANA_DEVNET_CHAIN_ID).toBe(9_100_001);
    expect(SOLANA_TESTNET_CHAIN_ID).toBe(9_100_002);
  });

  it("resolves the solana family", () => {
    expect(getChainFamily(SOLANA_MAINNET_CHAIN_ID)).toBe("solana");
    expect(getChainFamily(SOLANA_DEVNET_CHAIN_ID)).toBe("solana");
    expect(isSolanaChain(SOLANA_MAINNET_CHAIN_ID)).toBe(true);
    expect(isSolanaChainId(SOLANA_DEVNET_CHAIN_ID)).toBe(true);
    expect(isEvmChain(SOLANA_MAINNET_CHAIN_ID)).toBe(false);
    // Solana ids must NOT be treated as Stellar.
    expect(getChainFamily(9_000_001)).toBe("stellar");
  });

  it("validates Solana addresses and tx signatures by family", () => {
    const addr = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(isValidAddressForChain(addr, SOLANA_MAINNET_CHAIN_ID)).toBe(true);
    // A 0x EVM address is not valid on Solana.
    expect(
      isValidAddressForChain("0xabcdef1234567890abcdef1234567890abcdef12", SOLANA_MAINNET_CHAIN_ID),
    ).toBe(false);
    // Base58 tx signature (~88 chars).
    const sig =
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    expect(isValidTxHashForChain(sig, SOLANA_MAINNET_CHAIN_ID)).toBe(true);
  });

  it("uses the empty string as the Solana unset-address sentinel", () => {
    expect(unsetAddressForFamily("solana")).toBe("");
  });

  it("resolves Solana RPC URLs from the registry with env override", () => {
    expect(getSolanaRpcUrl(SOLANA_MAINNET_CHAIN_ID)).toContain("mainnet-beta");
    expect(getSolanaRpcUrl(SOLANA_DEVNET_CHAIN_ID)).toContain("devnet");
  });
});

describe("normalizeX402AmountToDecimal", () => {
  it("keeps decimal strings verbatim", () => {
    expect(normalizeX402AmountToDecimal("0.01")).toBe("0.01");
    expect(normalizeX402AmountToDecimal("10.0")).toBe("10.0");
    expect(normalizeX402AmountToDecimal("0.000001")).toBe("0.000001");
  });

  it("treats pure-integer strings as atomic and converts to decimal", () => {
    // The x402 middleware advertises maxAmountRequired as an ATOMIC integer
    // string ("10000" = 0.01 USDC) — so integer strings must be converted to
    // their canonical decimal form on BOTH the agent signer and the verifier.
    expect(normalizeX402AmountToDecimal("10000")).toBe("0.01");
    expect(normalizeX402AmountToDecimal("1000000")).toBe("1");
    expect(normalizeX402AmountToDecimal("1500000")).toBe("1.5");
    expect(normalizeX402AmountToDecimal("1")).toBe("0.000001");
    // "10" atomic micros → 0.00001 USDC
    expect(normalizeX402AmountToDecimal("10")).toBe("0.00001");
  });

  it("converts bigint atomic units to decimal", () => {
    expect(normalizeX402AmountToDecimal(10_000_000n)).toBe("10");
    expect(normalizeX402AmountToDecimal(10_000n)).toBe("0.01");
  });

  it("converts atomic-unit strings deterministically", () => {
    // Repeated calls must produce identical output (the agent signer and node
    // verifier rebuild the exact same signed string).
    expect(normalizeX402AmountToDecimal("2500000")).toBe(
      normalizeX402AmountToDecimal("2500000"),
    );
    expect(normalizeX402AmountToDecimal("0.05")).toBe(
      normalizeX402AmountToDecimal("0.05"),
    );
  });
});
