import { describe, expect, it } from "vitest";
import {
  resolveEnvironmentChainId,
  isSupportedDashboardChainId,
  DEFAULT_MAINNET_CHAIN_ID,
} from "../../../src/lib/platform/default-chain.js";
import {
  isSolanaChainId,
  isStellarChainId,
  isEvmChain,
  getChainFamily,
} from "@arcenpay/internal-core";
import { isChainAllowedForMode } from "../../../src/lib/environments/workspace-environments.js";
import { getTierLimits } from "../../../src/lib/catalog/tier-guard.js";

describe("Multi-chain platform isolation & default-chain resolution", () => {
  it("never falls back to an EVM chain in DEVELOPMENT when chainId is omitted or null", () => {
    expect(resolveEnvironmentChainId("DEVELOPMENT", undefined)).toBeNull();
    expect(resolveEnvironmentChainId("DEVELOPMENT", null)).toBeNull();
  });

  it("correctly resolves Solana Devnet (9100001) in DEVELOPMENT without EVM coercion", () => {
    const chainId = resolveEnvironmentChainId("DEVELOPMENT", 9100001);
    expect(chainId).toBe(9100001);
    expect(isSolanaChainId(chainId!)).toBe(true);
    expect(isEvmChain(chainId!)).toBe(false);
    expect(isStellarChainId(chainId!)).toBe(false);
    expect(getChainFamily(chainId!)).toBe("solana");
  });

  it("correctly resolves Stellar Testnet (9000001) in DEVELOPMENT without EVM coercion", () => {
    const chainId = resolveEnvironmentChainId("DEVELOPMENT", 9000001);
    expect(chainId).toBe(9000001);
    expect(isStellarChainId(chainId!)).toBe(true);
    expect(isEvmChain(chainId!)).toBe(false);
    expect(isSolanaChainId(chainId!)).toBe(false);
    expect(getChainFamily(chainId!)).toBe("stellar");
  });

  it("resolves supported EVM chains in DEVELOPMENT (e.g. Base Sepolia 84532, Arc Testnet 5042002)", () => {
    expect(resolveEnvironmentChainId("DEVELOPMENT", 84532)).toBe(84532);
    expect(getChainFamily(84532)).toBe("evm");
    expect(isEvmChain(84532)).toBe(true);

    expect(resolveEnvironmentChainId("DEVELOPMENT", 5042002)).toBe(5042002);
    expect(getChainFamily(5042002)).toBe("evm");
    expect(isEvmChain(5042002)).toBe(true);
  });

  it("rejects unknown or invalid chain IDs with null instead of falling back to EVM", () => {
    expect(resolveEnvironmentChainId("DEVELOPMENT", 99999999)).toBeNull();
    expect(resolveEnvironmentChainId("DEVELOPMENT", -1)).toBeNull();
    expect(isSupportedDashboardChainId(99999999)).toBe(false);
  });

  it("enforces strict mode separation (mainnet chains rejected in DEVELOPMENT, testnet rejected in PRODUCTION)", () => {
    // BOT Mainnet (677) and Solana Mainnet (9100000) are production chains, must be rejected in DEVELOPMENT
    expect(resolveEnvironmentChainId("DEVELOPMENT", 677)).toBeNull();
    expect(resolveEnvironmentChainId("DEVELOPMENT", 9100000)).toBeNull();
    // Testnet chains are rejected in PRODUCTION (falls back to default mainnet chain)
    expect(resolveEnvironmentChainId("PRODUCTION", 9100001)).toBe(DEFAULT_MAINNET_CHAIN_ID);
    expect(resolveEnvironmentChainId("PRODUCTION", 84532)).toBe(DEFAULT_MAINNET_CHAIN_ID);
    // Stellar Mainnet (9000000) has no deployed contracts, must not be valid
    expect(resolveEnvironmentChainId("PRODUCTION", 9000000)).toBe(DEFAULT_MAINNET_CHAIN_ID);
  });

  it("correctly resolves and allows Solana Mainnet (9100000) in PRODUCTION", () => {
    expect(resolveEnvironmentChainId("PRODUCTION", 9100000)).toBe(9100000);
    expect(isSupportedDashboardChainId(9100000)).toBe(true);
    expect(isChainAllowedForMode("PRODUCTION", 9100000)).toBe(true);
    expect(isSolanaChainId(9100000)).toBe(true);
    expect(getChainFamily(9100000)).toBe("solana");
  });

  it("allows Solana Devnet (9100001) and Stellar Testnet (9000001) environment creation in DEVELOPMENT", () => {
    expect(isChainAllowedForMode("DEVELOPMENT", 9100001)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 9000001)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 84532)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 9100000)).toBe(false);
    expect(isChainAllowedForMode("DEVELOPMENT", 99999999)).toBe(false);
    expect(isChainAllowedForMode("PRODUCTION", 9000000)).toBe(false);
  });

  it("allows multi-chain environments on FREE tier without hitting single-chain ceiling", async () => {
    const freeLimits = await getTierLimits("FREE");
    expect(freeLimits.maxChains).toBeGreaterThanOrEqual(3);
    expect(freeLimits.maxDevelopmentEnvironments).toBeGreaterThanOrEqual(3);
  });
});
