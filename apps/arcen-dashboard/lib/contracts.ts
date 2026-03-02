// ============================================================
//  Dashboard — Contract helpers
//  Re-exports @meap/core ABIs + addresses; exposes a hook
//  that resolves addresses for the currently connected chain.
// ============================================================

import { useChainId } from "wagmi";
import {
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  FeeCollectorABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  ERC7579AutopayModuleABI,
  TOKENS,
} from "@meap/core";

export {
  getContractAddresses,
  PlanFactoryABI,
  SubscriptionRegistryABI,
  FeeCollectorABI,
  SessionVaultABI,
  ZKUsageVerifierABI,
  ERC7579AutopayModuleABI,
  TOKENS,
};

/** Returns live contract addresses for the wallet's current chain.
 *  Falls back to Sepolia (11155111) when chain is unsupported. */
export function useContractAddresses() {
  const chainId = useChainId();
  try {
    return getContractAddresses(chainId);
  } catch {
    return getContractAddresses(11155111);
  }
}

/** Sepolia USDC token address (Circle testnet deployment) */
export const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
