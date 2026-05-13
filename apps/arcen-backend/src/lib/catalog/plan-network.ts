import {
  ARC_TESTNET_CHAIN_ID,
  getChainIdsForEnvironment,
  isSupportedDashboardChainId,
  type EnvironmentMode,
  type SupportedDashboardChainId,
} from "../platform/default-chain.js";
import { getUsdcAddress } from "../platform/contracts.js";

const LEGACY_ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export interface ResolvedPlanNetwork {
  chainId: SupportedDashboardChainId;
  acceptedToken: `0x${string}`;
}

function normalizeAddress(value: string | undefined | null): `0x${string}` | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!EVM_ADDRESS_REGEX.test(trimmed)) return null;
  return trimmed as `0x${string}`;
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
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

  const normalizedToken = normalizeAddress(input.acceptedToken);
  const requestedChainId =
    input.requestedChainId != null &&
    isSupportedDashboardChainId(input.requestedChainId) &&
    allowedChainIds.includes(input.requestedChainId)
      ? input.requestedChainId
      : null;

  if (
    normalizedToken &&
    sameAddress(normalizedToken, LEGACY_ARC_TESTNET_USDC) &&
    allowedChainIds.includes(ARC_TESTNET_CHAIN_ID)
  ) {
    return {
      chainId: ARC_TESTNET_CHAIN_ID,
      acceptedToken: getUsdcAddress(ARC_TESTNET_CHAIN_ID),
    };
  }

  if (requestedChainId != null) {
    const acceptedToken = getUsdcAddress(requestedChainId);
    if (!normalizedToken || sameAddress(normalizedToken, acceptedToken)) {
      return { chainId: requestedChainId, acceptedToken };
    }
  }

  if (normalizedToken) {
    const matches = allowedChainIds.filter((chainId) =>
      sameAddress(normalizedToken, getUsdcAddress(chainId)),
    );
    if (matches.length === 1) {
      return {
        chainId: matches[0],
        acceptedToken: getUsdcAddress(matches[0]),
      };
    }
  }

  return null;
}
