// ============================================================
//  Dashboard — Contract helpers
//  Re-exports @arcenpay/internal-core ABIs + addresses; exposes a hook
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
  getTokenAddress,
  getTokensForChain,
  getChain,
} from "@arcenpay/internal-core";
import {
  BASE_SEPOLIA_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  DEFAULT_CHAIN_ID,
  getChainLabel,
} from "@/lib/default-chain";

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

  const token = getTokenAddress(chainId, "USDC");
  if (isAddress(token)) return token;
  return "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
}

const CHAIN_LIST: Array<{
  chainId: number;
  label: string;
  tag: "testnet" | "mainnet";
}> = [
  {
    chainId: BASE_SEPOLIA_CHAIN_ID,
    label: getChainLabel(BASE_SEPOLIA_CHAIN_ID),
    tag: "testnet",
  },
  {
    chainId: ARC_TESTNET_CHAIN_ID,
    label: getChainLabel(ARC_TESTNET_CHAIN_ID),
    tag: "testnet",
  },
];

export interface TokenOption {
  chainId: number;
  chainLabel: string;
  tag: "testnet" | "mainnet";
  symbol: string;
  address: `0x${string}`;
  source: "default" | "override";
}

export function getTokenOptions(): TokenOption[] {
  const options: TokenOption[] = [];

  for (const chain of CHAIN_LIST) {
    const symbols = getTokensForChain(chain.chainId);
    if (symbols.length === 0) continue;

    for (const symbol of symbols) {
      const override = resolveUsdcOverride(chain.chainId);
      const address = getTokenAddress(chain.chainId, symbol);
      if (!address) continue;

      options.push({
        chainId: chain.chainId,
        chainLabel: chain.label,
        tag: chain.tag,
        symbol,
        address,
        source: override ? "override" : "default",
      });
    }
  }

  return options;
}

/** @deprecated — use getTokenOptions() instead */
export function getUsdcTokenOptions() {
  return getTokenOptions().map((opt) => ({
    chainId: opt.chainId,
    label: `${opt.symbol} — ${opt.chainLabel}`,
    tag: opt.tag,
    address: opt.address,
    source: opt.source,
  }));
}

/** Returns live contract addresses for the wallet's current chain.
 *  Falls back to the configured default chain when unsupported. */
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
    return getContractAddresses(DEFAULT_CHAIN_ID);
  }
}

/** Backward-compatible alias for Sepolia token resolution */
export const SEPOLIA_USDC = getUsdcAddress(DEFAULT_CHAIN_ID);
