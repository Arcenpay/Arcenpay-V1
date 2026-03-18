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
  YieldSessionVaultABI,
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
  YieldSessionVaultABI,
  TOKENS,
};

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function isAddress(value: string | undefined | null): value is `0x${string}` {
  return typeof value === "string" && EVM_ADDRESS_REGEX.test(value);
}

function resolveUsdcOverride(chainId: number): `0x${string}` | null {
  const globalOverride =
    process.env.NEXT_PUBLIC_USDC_ADDRESS || process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS;

  const chainOverrides: Record<number, string | undefined> = {
    11155111:
      process.env.NEXT_PUBLIC_USDC_ADDRESS_11155111 ||
      process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS_11155111,
    84532:
      process.env.NEXT_PUBLIC_USDC_ADDRESS_84532 ||
      process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS_84532,
    8453:
      process.env.NEXT_PUBLIC_USDC_ADDRESS_8453 ||
      process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS_8453,
  };

  const candidate = chainOverrides[chainId] || globalOverride;
  if (!isAddress(candidate)) return null;
  return candidate;
}

export function getUsdcAddress(chainId: number): `0x${string}` {
  const override = resolveUsdcOverride(chainId);
  if (override) return override;

  const token = TOKENS[chainId as keyof typeof TOKENS]?.USDC;
  if (isAddress(token)) return token;
  return TOKENS[11155111].USDC as `0x${string}`;
}

export function getUsdcTokenOptions(): Array<{
  chainId: number;
  label: string;
  tag: "testnet" | "mainnet";
  address: `0x${string}`;
  source: "default" | "override";
}> {
  const chains: Array<{
    chainId: number;
    label: string;
    tag: "testnet" | "mainnet";
  }> = [
    { chainId: 11155111, label: "Sepolia", tag: "testnet" },
    { chainId: 84532, label: "Base Sepolia", tag: "testnet" },
    { chainId: 8453, label: "Base", tag: "mainnet" },
  ];

  const options: Array<{
    chainId: number;
    label: string;
    tag: "testnet" | "mainnet";
    address: `0x${string}`;
    source: "default" | "override";
  }> = [];

  for (const chain of chains) {
    const override = resolveUsdcOverride(chain.chainId);
    const address = getUsdcAddress(chain.chainId);
    options.push({
      chainId: chain.chainId,
      label: `${override ? "Custom USDC" : "USDC"} — ${chain.label}`,
      tag: chain.tag,
      address,
      source: override ? "override" : "default",
    });
  }

  return options;
}

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

/** Backward-compatible alias for Sepolia token resolution */
export const SEPOLIA_USDC = getUsdcAddress(11155111);
