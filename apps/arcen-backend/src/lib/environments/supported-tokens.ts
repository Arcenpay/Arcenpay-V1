import { getTokenAddress, getTokensForChain } from "@arcenpay/internal-core";
import { getUsdcAddress } from "../platform/contracts.js";

const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!EVM_ADDRESS_REGEX.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function getSupportedAcceptedTokensForChain(chainId: number): `0x${string}`[] {
  const tokens = new Set<string>();

  for (const symbol of getTokensForChain(chainId)) {
    const address =
      symbol === "USDC" ? getUsdcAddress(chainId) : getTokenAddress(chainId, symbol);
    if (!address) continue;
    const normalized = normalizeAddress(address);
    if (normalized) tokens.add(normalized);
  }

  return Array.from(tokens) as `0x${string}`[];
}

export function isAcceptedTokenSupportedOnChain(
  chainId: number,
  acceptedToken: string,
): boolean {
  const normalized = normalizeAddress(acceptedToken);
  if (!normalized) return false;
  return getSupportedAcceptedTokensForChain(chainId).some(
    (token) => token.toLowerCase() === normalized,
  );
}
