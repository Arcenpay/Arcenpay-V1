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
  TOKENS,
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
  TOKENS,
};

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: string | undefined | null): value is `0x${string}` {
  return typeof value === "string" && EVM_ADDRESS_REGEX.test(value);
}

function resolveUsdcOverride(chainId: number): `0x${string}` | null {
  const candidate =
    process.env[`ARCENPAY_USDC_ADDRESS_${chainId}`] ??
    process.env[`NEXT_PUBLIC_USDC_ADDRESS_${chainId}`];

  if (!isAddress(candidate)) return null;
  return candidate;
}

export function getUsdcAddress(chainId: number): `0x${string}` {
  const override = resolveUsdcOverride(chainId);
  if (override) return override;

  const token = TOKENS[chainId as keyof typeof TOKENS]?.USDC;
  if (isAddress(token)) return token;
  return TOKENS[DEFAULT_CHAIN_ID].USDC as `0x${string}`;
}
