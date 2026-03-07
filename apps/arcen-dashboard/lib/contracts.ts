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
    const addresses = getContractAddresses(chainId);
    if (process.env.NODE_ENV === "production") {
      const hasZero = Object.values(addresses).some(
        (value) =>
          typeof value === "string" &&
          value.toLowerCase() === "0x0000000000000000000000000000000000000000",
      );
      if (hasZero) {
        throw new Error(
          `Chain ${chainId} has incomplete contract addresses; production fallback is disabled.`,
        );
      }
    }
    return addresses;
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `Unsupported chain ${chainId}. Configure supported production chain before enabling this workspace.`,
      );
    }
    return getContractAddresses(11155111);
  }
}

/** Sepolia USDC token address (Circle testnet deployment) */
export const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
