import {
  getTokenAddress,
  getTokensForChain,
  isValidAddressForChain,
  isEvmChain,
} from "@arcenpay/internal-core";
import { getUsdcAddress } from "../platform/contracts.js";

function normalizeAddress(value: string, chainId: number): string | null {
  const trimmed = value.trim();
  if (!isValidAddressForChain(trimmed, chainId)) return null;
  return isEvmChain(chainId) ? trimmed.toLowerCase() : trimmed;
}

export function getSupportedAcceptedTokensForChain(chainId: number): string[] {
  const tokens = new Set<string>();

  for (const symbol of getTokensForChain(chainId)) {
    const address =
      symbol === "USDC" ? getUsdcAddress(chainId) : getTokenAddress(chainId, symbol);
    if (!address) continue;
    const normalized = normalizeAddress(address, chainId);
    if (normalized) tokens.add(normalized);
  }

  return Array.from(tokens);
}

export function isAcceptedTokenSupportedOnChain(
  chainId: number,
  acceptedToken: string,
): boolean {
  const normalized = normalizeAddress(acceptedToken, chainId);
  if (!normalized) return false;
  return getSupportedAcceptedTokensForChain(chainId).some(
    (token) => token === normalized,
  );
}
