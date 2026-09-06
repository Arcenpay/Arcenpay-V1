// ============================================================
//  Backend — Contract helpers
//  Resolves USDC token addresses per chain. Defaults come from
//  @arcenpay/internal-core; overridable via ARCENPAY_USDC_ADDRESS_<chainId> env vars.
// ============================================================

import {
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  FeeCollectorABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  ERC7579AutopayModuleABI,
  YieldSessionVaultABI,
  getTokenAddress,
  isValidAddressForChain,
} from "@arcenpay/internal-core";
import { DEFAULT_CHAIN_ID } from "./default-chain.js";

export {
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  FeeCollectorABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  ERC7579AutopayModuleABI,
  YieldSessionVaultABI,
  getTokenAddress,
};

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isEvmAddress(value: string | undefined | null): value is `0x${string}` {
  return typeof value === "string" && EVM_ADDRESS_REGEX.test(value);
}

function resolveUsdcOverride(chainId: number): string | null {
  const candidate =
    process.env[`ARCENPAY_USDC_ADDRESS_${chainId}`] ??
    process.env[`NEXT_PUBLIC_USDC_ADDRESS_${chainId}`];

  if (!candidate || !isValidAddressForChain(candidate, chainId)) return null;
  return candidate;
}

/**
 * Returns the canonical USDC address for a chain. Supports both EVM
 * (0x-prefixed hex) and Stellar (G…/C… base32) addresses.
 * Returns `undefined` if no USDC is configured for the chain.
 * Callers must handle the missing case or use {@link getEvmUsdcAddress}
 * for EVM-only contexts that should fail fast.
 */
export function getUsdcAddress(chainId: number): string | undefined {
  const override = resolveUsdcOverride(chainId);
  if (override) return override;

  const token = getTokenAddress(chainId, "USDC");
  if (token && isValidAddressForChain(token, chainId)) return token;

  return undefined;
}

/**
 * EVM-only variant of {@link getUsdcAddress}. Throws for non-EVM chains or
 * missing tokens so viem call sites fail fast with a clear message.
 */
export function getEvmUsdcAddress(chainId: number): `0x${string}` {
  const addr = getUsdcAddress(chainId);
  if (!addr || !isEvmAddress(addr)) {
    throw new Error(
      `getEvmUsdcAddress: no EVM USDC configured for chain ${chainId}. ` +
        `Use getUsdcAddress for cross-family code.`,
    );
  }
  return addr;
}
