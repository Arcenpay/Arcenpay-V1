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
  isValidAddressForChain,
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
} from "@arcenpay/internal-core";
import {
  BASE_SEPOLIA_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  BOT_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  DEFAULT_CHAIN_ID,
  getChainLabel,
} from "@/lib/default-chain";
import type { EnvironmentMode } from "@/lib/default-chain";

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

function resolveUsdcOverride(chainId: number): string | null {
  const globalOverride = process.env.NEXT_PUBLIC_USDC_ADDRESS;

  const chainOverrides: Record<number, string | undefined> = {
    11155111: process.env.NEXT_PUBLIC_USDC_ADDRESS_11155111,
    84532: process.env.NEXT_PUBLIC_USDC_ADDRESS_84532,
    8453: process.env.NEXT_PUBLIC_USDC_ADDRESS_8453,
    5042002: process.env.NEXT_PUBLIC_USDC_ADDRESS_5042002,
    677: process.env.NEXT_PUBLIC_USDC_ADDRESS_677,
    968: process.env.NEXT_PUBLIC_USDC_ADDRESS_968,
    9000000: process.env.NEXT_PUBLIC_USDC_ADDRESS_9000000,
    9000001: process.env.NEXT_PUBLIC_USDC_ADDRESS_9000001,
    9000002: process.env.NEXT_PUBLIC_USDC_ADDRESS_9000002,
    9100000: process.env.NEXT_PUBLIC_USDC_ADDRESS_9100000,
    9100001: process.env.NEXT_PUBLIC_USDC_ADDRESS_9100001,
    9100002: process.env.NEXT_PUBLIC_USDC_ADDRESS_9100002,
  };

  const candidate = chainOverrides[chainId] || globalOverride;
  if (!candidate || !isValidAddressForChain(candidate, chainId)) return null;
  return candidate;
}

export function getUsdcAddress(chainId: number): string {
  const override = resolveUsdcOverride(chainId);
  if (override) return override;

  const token = getTokenAddress(chainId, "USDC");
  if (token && isValidAddressForChain(token, chainId)) return token;

  // BOT Chain (677, 968) has no native USDC — fall back to USDT
  const usdtToken = getTokenAddress(chainId, "USDT");
  if (usdtToken && isValidAddressForChain(usdtToken, chainId)) return usdtToken;

  throw new Error(
    `No USDC address configured for chain ${chainId}. Set NEXT_PUBLIC_USDC_ADDRESS_${chainId} or NEXT_PUBLIC_USDC_ADDRESS.`,
  );
}

/**
 * EVM-only variant of {@link getUsdcAddress}. Throws for non-EVM chains so
 * wagmi/viem call sites get the correct `0x${string}` type. Prefer
 * {@link getUsdcAddress} for cross-family code.
 */
export function getEvmUsdcAddress(chainId: number): `0x${string}` {
  const addr = getUsdcAddress(chainId);
  if (!addr.startsWith("0x")) {
    throw new Error(
      `getEvmUsdcAddress called with non-EVM chain ${chainId}. Use getUsdcAddress for cross-family code.`,
    );
  }
  return addr as `0x${string}`;
}

const TESTNET_CHAIN_LIST: Array<{
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
  {
    chainId: STELLAR_TESTNET_CHAIN_ID,
    label: getChainLabel(STELLAR_TESTNET_CHAIN_ID),
    tag: "testnet",
  },
  {
    chainId: SOLANA_DEVNET_CHAIN_ID,
    label: getChainLabel(SOLANA_DEVNET_CHAIN_ID),
    tag: "testnet",
  },
];

const MAINNET_CHAIN_LIST: Array<{
  chainId: number;
  label: string;
  tag: "testnet" | "mainnet";
}> = [
  {
    chainId: BOT_MAINNET_CHAIN_ID,
    label: getChainLabel(BOT_MAINNET_CHAIN_ID),
    tag: "mainnet",
  },
  {
    chainId: SOLANA_MAINNET_CHAIN_ID,
    label: getChainLabel(SOLANA_MAINNET_CHAIN_ID),
    tag: "mainnet",
  },
];

// All chains (used when no env mode filter is required)
const CHAIN_LIST = [...TESTNET_CHAIN_LIST, ...MAINNET_CHAIN_LIST];

export interface TokenOption {
  chainId: number;
  chainLabel: string;
  tag: "testnet" | "mainnet";
  symbol: string;
  // Family-agnostic: EVM addresses are 0x-hex; Stellar SAC issuers are G… accounts.
  address: string;
  source: "default" | "override";
}

export function getTokenOptions(): TokenOption[] {
  return buildTokenOptions(CHAIN_LIST);
}

export function getTokenOptionsForChain(chainId?: number | null): TokenOption[] {
  if (!chainId) return [];
  const chain = CHAIN_LIST.find((entry) => entry.chainId === chainId);
  if (!chain) return [];
  return buildTokenOptions([chain]);
}

/** Returns token options filtered to chains valid for the given env mode.
 *  DEV → testnet chains only. PROD → mainnet chains only. */
export function getTokenOptionsForEnvironment(
  mode: EnvironmentMode,
): TokenOption[] {
  return buildTokenOptions(
    mode === "PRODUCTION" ? MAINNET_CHAIN_LIST : TESTNET_CHAIN_LIST,
  );
}

function buildTokenOptions(
  chainList: typeof CHAIN_LIST,
): TokenOption[] {
  const options: TokenOption[] = [];

  for (const chain of chainList) {
    const symbols = getTokensForChain(chain.chainId);
    if (symbols.length === 0) continue;

    for (const symbol of symbols) {
      const override = resolveUsdcOverride(chain.chainId);
      const address =
        symbol === "USDC"
          ? (override ?? getTokenAddress(chain.chainId, symbol))
          : getTokenAddress(chain.chainId, symbol);
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

/** Returns live contract addresses for the requested chain, or the wallet's
 * current chain when no override is supplied. Falls back to the configured
 * default chain when unsupported in development. */
export function useContractAddresses(chainIdOverride?: number | null) {
  const walletChainId = useChainId();
  const chainId = (chainIdOverride !== undefined && chainIdOverride !== null) ? chainIdOverride : walletChainId;
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
export const SEPOLIA_USDC = (() => {
  try {
    return getUsdcAddress(BASE_SEPOLIA_CHAIN_ID);
  } catch {
    return "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  }
})();
