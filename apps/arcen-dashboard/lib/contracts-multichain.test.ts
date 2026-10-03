import { describe, expect, it } from "vitest";
import { getTokenOptionsForChain } from "./contracts";
import { getChainLabel, BASE_SEPOLIA_CHAIN_ID } from "./default-chain";
import {
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
} from "@arcenpay/internal-core";

describe("Dashboard multi-chain token options & network labels", () => {
  it("returns empty token list when chainId is null or undefined (zero EVM fallback)", () => {
    expect(getTokenOptionsForChain(null)).toEqual([]);
    expect(getTokenOptionsForChain(undefined)).toEqual([]);
  });

  it("returns empty token list for disabled Solana Devnet (9100001)", () => {
    const tokens = getTokenOptionsForChain(SOLANA_DEVNET_CHAIN_ID);
    expect(tokens).toEqual([]);
  });

  it("returns only Solana tokens for Solana Mainnet (9100000), including canonical Circle USDC", () => {
    const tokens = getTokenOptionsForChain(SOLANA_MAINNET_CHAIN_ID);
    expect(tokens.length).toBeGreaterThan(0);
    const usdc = tokens.find((t) => t.symbol === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc!.address).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(usdc!.address.startsWith("0x")).toBe(false);
  });

  it("returns only Stellar tokens for Stellar Testnet (9000001), never EVM addresses", () => {
    const tokens = getTokenOptionsForChain(STELLAR_TESTNET_CHAIN_ID);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.chainId).toBe(STELLAR_TESTNET_CHAIN_ID);
      // Stellar contract IDs / issuer accounts do not start with 0x
      expect(token.address.startsWith("0x")).toBe(false);
    }
  });

  it("returns EVM tokens for Base Sepolia (84532)", () => {
    const tokens = getTokenOptionsForChain(BASE_SEPOLIA_CHAIN_ID);
    expect(tokens.length).toBeGreaterThan(0);
    for (const token of tokens) {
      expect(token.chainId).toBe(BASE_SEPOLIA_CHAIN_ID);
      expect(token.address.startsWith("0x")).toBe(true);
    }
  });

  it("getChainLabel returns 'Select network' for null/undefined chainId", () => {
    expect(getChainLabel(null)).toBe("Select network");
    expect(getChainLabel(undefined)).toBe("Select network");
  });

  it("getChainLabel returns friendly labels for Solana and Stellar", () => {
    expect(getChainLabel(SOLANA_MAINNET_CHAIN_ID)).toContain("Solana");
    expect(getChainLabel(STELLAR_TESTNET_CHAIN_ID)).toContain("Stellar");
  });
});
