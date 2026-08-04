import {
  isValidAddressForChain,
  isEvmChain,
} from "@arcenpay/internal-core";
import {
  ARC_TESTNET_CHAIN_ID,
  getChainIdsForEnvironment,
  isSupportedDashboardChainId,
  type EnvironmentMode,
  type SupportedDashboardChainId,
} from "../platform/default-chain.js";
import { getUsdcAddress } from "../platform/contracts.js";

const LEGACY_ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

export interface ResolvedPlanNetwork {
  chainId: SupportedDashboardChainId;
  acceptedToken: string;
}

function sameAddress(a: string, b: string, chainId: number): boolean {
  if (isEvmChain(chainId)) {
    return a.toLowerCase() === b.toLowerCase();
  }
  // Stellar (and future non-EVM families): case-sensitive comparison
  return a === b;
}

/** Safe wrapper around getUsdcAddress that never throws. */
function safeGetUsdcAddress(chainId: number): string | null {
  return getUsdcAddress(chainId) ?? null;
}

function getAllowedChainIds(environmentMode: EnvironmentMode): SupportedDashboardChainId[] {
  return getChainIdsForEnvironment(environmentMode).filter(
    isSupportedDashboardChainId,
  );
}

export function resolvePlanNetwork(input: {
  environmentMode: EnvironmentMode;
  acceptedToken?: string | null;
  requestedChainId?: number | null;
}): ResolvedPlanNetwork | null {
  const allowedChainIds = getAllowedChainIds(input.environmentMode);
  if (allowedChainIds.length === 0) return null;

  const rawToken = input.acceptedToken?.trim() ?? null;
  const requestedChainId =
    input.requestedChainId != null &&
    isSupportedDashboardChainId(input.requestedChainId) &&
    allowedChainIds.includes(input.requestedChainId)
      ? input.requestedChainId
      : null;

  // Legacy Arc Testnet USDC migration — only applies to EVM Arc Testnet
  if (
    rawToken &&
    isEvmChain(ARC_TESTNET_CHAIN_ID) &&
    sameAddress(rawToken, LEGACY_ARC_TESTNET_USDC, ARC_TESTNET_CHAIN_ID) &&
    allowedChainIds.includes(ARC_TESTNET_CHAIN_ID)
  ) {
    const token = safeGetUsdcAddress(ARC_TESTNET_CHAIN_ID);
    if (token) {
      return { chainId: ARC_TESTNET_CHAIN_ID, acceptedToken: token };
    }
  }

  // If a chain is explicitly requested, validate the token matches that chain
  if (requestedChainId != null) {
    const canonicalToken = safeGetUsdcAddress(requestedChainId);
    if (canonicalToken) {
      if (!rawToken || sameAddress(rawToken, canonicalToken, requestedChainId)) {
        return { chainId: requestedChainId, acceptedToken: canonicalToken };
      }
    }
    // If the token doesn't match the canonical USDC for the chain, but is
    // a valid address on that chain, accept it as a custom token override.
    if (rawToken && isValidAddressForChain(rawToken, requestedChainId)) {
      return { chainId: requestedChainId, acceptedToken: rawToken };
    }
  }

  // No chain requested — try to resolve chain from token address alone
  if (rawToken) {
    const matches = allowedChainIds.filter((chainId) => {
      const token = safeGetUsdcAddress(chainId);
      return token && sameAddress(rawToken, token, chainId);
    });
    if (matches.length === 1) {
      const token = safeGetUsdcAddress(matches[0]);
      if (token) {
        return { chainId: matches[0], acceptedToken: token };
      }
    }
  }

  return null;
}
