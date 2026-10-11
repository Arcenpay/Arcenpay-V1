import { describe, expect, it, vi } from "vitest";

// The billing modules import config.ts, which fails fast when NODE_ENV is
// "production" and secrets are absent. Force a test env before those imports
// are evaluated (vi.hoisted runs ahead of the import statements below).
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
});

import {
  getTokenAddress,
  isEvmChain,
  isSolanaChainId,
} from "@arcenpay/internal-core";
import {
  normalizePlatformAddress,
  platformBillingToken,
} from "../../../src/lib/billing/platform-tier-billing.js";

const SOLANA_DEVNET = 9100001;
const SOLANA_MAINNET = 9100000;
const BASE_SEPOLIA = 84532;

const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const MAINNET_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

describe("platform self-billing — chain-aware helpers", () => {
  it("preserves Base58 case for Solana and lowercases EVM addresses", () => {
    // Mixed-case Base58 is significant and must survive untouched.
    expect(normalizePlatformAddress(DEVNET_USDC_MINT, SOLANA_DEVNET)).toBe(
      DEVNET_USDC_MINT,
    );
    expect(normalizePlatformAddress(BASE_SEPOLIA_USDC, BASE_SEPOLIA)).toBe(
      BASE_SEPOLIA_USDC.toLowerCase(),
    );
  });

  it("rejects cross-family addresses instead of coercing them", () => {
    // An EVM address is not a valid Solana address and vice versa.
    expect(normalizePlatformAddress(BASE_SEPOLIA_USDC, SOLANA_DEVNET)).toBeNull();
    expect(normalizePlatformAddress(DEVNET_USDC_MINT, BASE_SEPOLIA)).toBeNull();
    expect(normalizePlatformAddress("", SOLANA_DEVNET)).toBeNull();
    expect(normalizePlatformAddress(null, SOLANA_DEVNET)).toBeNull();
  });

  it("resolves the correct accepted token per chain family", () => {
    // Solana resolves to the chain's SPL mint regardless of any EVM default.
    expect(platformBillingToken(SOLANA_DEVNET)).toBe(DEVNET_USDC_MINT);
    expect(platformBillingToken(SOLANA_MAINNET)).toBe(MAINNET_USDC_MINT);

    // EVM resolves to a lowercased 0x token.
    const evmToken = platformBillingToken(BASE_SEPOLIA);
    expect(evmToken.startsWith("0x")).toBe(true);
    expect(evmToken).toBe(evmToken.toLowerCase());
  });

  it("agrees with the internal-core token registry", () => {
    expect(getTokenAddress(SOLANA_DEVNET, "USDC")).toBe(DEVNET_USDC_MINT);
    expect(isSolanaChainId(SOLANA_DEVNET)).toBe(true);
    expect(isEvmChain(SOLANA_DEVNET)).toBe(false);
    expect(isEvmChain(BASE_SEPOLIA)).toBe(true);
  });
});
