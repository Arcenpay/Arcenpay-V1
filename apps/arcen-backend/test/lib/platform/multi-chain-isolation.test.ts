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

  it("seamlessly migrates disabled Solana Devnet (9100001) to Solana Mainnet (9100000) without EVM coercion", () => {
    const chainId = resolveEnvironmentChainId("DEVELOPMENT", 9100001);
    expect(chainId).toBe(9100000);
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

  it("enforces strict mode separation (EVM mainnet chains rejected in DEVELOPMENT)", () => {
    // BOT Mainnet (677) is a production-only EVM chain, must be rejected in DEVELOPMENT
    expect(resolveEnvironmentChainId("DEVELOPMENT", 677)).toBeNull();
    // Solana Mainnet (9100000) is allowed in DEVELOPMENT as the sole active Solana network
    expect(resolveEnvironmentChainId("DEVELOPMENT", 9100000)).toBe(9100000);
    // Legacy devnet requests in PRODUCTION migrate to Solana Mainnet
    expect(resolveEnvironmentChainId("PRODUCTION", 9100001)).toBe(9100000);
  });

  it("correctly resolves and allows Solana Mainnet (9100000) in PRODUCTION", () => {
    expect(resolveEnvironmentChainId("PRODUCTION", 9100000)).toBe(9100000);
    expect(isSupportedDashboardChainId(9100000)).toBe(true);
    expect(isChainAllowedForMode("PRODUCTION", 9100000)).toBe(true);
    expect(isSolanaChainId(9100000)).toBe(true);
    expect(getChainFamily(9100000)).toBe("solana");
  });

  it("allows Solana Mainnet (9100000) and Stellar Testnet (9000001) environment creation in DEVELOPMENT", () => {
    expect(isChainAllowedForMode("DEVELOPMENT", 9100000)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 9000001)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 84532)).toBe(true);
    expect(isChainAllowedForMode("DEVELOPMENT", 9100001)).toBe(false);
    expect(isChainAllowedForMode("DEVELOPMENT", 99999999)).toBe(false);
  });

  it("allows multi-chain environments on FREE tier without hitting single-chain ceiling", async () => {
    const freeLimits = await getTierLimits("FREE");
    expect(freeLimits.maxChains).toBeGreaterThanOrEqual(3);
    expect(freeLimits.maxDevelopmentEnvironments).toBeGreaterThanOrEqual(3);
  });
});
