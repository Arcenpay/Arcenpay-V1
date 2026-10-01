"use client";

import type { ChainFamily } from "@arcenpay/internal-core";

const CHAIN_FAMILY_KEY = "arcenpay_onboarding_chain_family";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(^|;\\s*)" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, maxAgeSeconds = 604800) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
}

const STELLAR_ACCOUNT_REGEX = /^G[A-Z2-7]{55}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function isStoredFamily(value: string | null): value is ChainFamily {
  return value === "evm" || value === "stellar" || value === "solana";
}

export function getOnboardingChainFamily(): ChainFamily | null {
  if (typeof window === "undefined") return null;
  try {
    // 1. Check localStorage
    const local = localStorage.getItem(CHAIN_FAMILY_KEY);
    if (isStoredFamily(local)) return local;

    // 2. Check sessionStorage
    const session = sessionStorage.getItem(CHAIN_FAMILY_KEY);
    if (isStoredFamily(session)) return session;

    // 3. Check Cookie
    const cookieVal = getCookie(CHAIN_FAMILY_KEY);
    if (isStoredFamily(cookieVal)) return cookieVal;

    return null;
  } catch {
    return null;
  }
}

export function setOnboardingChainFamily(family: ChainFamily) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAIN_FAMILY_KEY, family);
    sessionStorage.setItem(CHAIN_FAMILY_KEY, family);
    setCookie(CHAIN_FAMILY_KEY, family);
  } catch {
    // ignore
  }
}

/**
 * Resolves the effective chain family considering stored preference and linked
 * wallet addresses. Defaults to "evm" if ambiguous.
 *
 * Only one of the three wallet addresses is normally present; a Solana address
 * is base58 (no `0x`), a Stellar address is a `G…` account, everything else is
 * treated as EVM.
 */
export function resolveEffectiveChainFamily(
  storedFamily?: ChainFamily | null,
  walletAddress?: string | null,
  stellarWalletAddress?: string | null,
  solanaWalletAddress?: string | null,
): ChainFamily {
  if (isStoredFamily(storedFamily ?? null)) {
    return storedFamily as ChainFamily;
  }
  if (solanaWalletAddress && !stellarWalletAddress) {
    return "solana";
  }
  if (stellarWalletAddress && !solanaWalletAddress) {
    return "stellar";
  }
  if (
    walletAddress &&
    !stellarWalletAddress &&
    !solanaWalletAddress &&
    !STELLAR_ACCOUNT_REGEX.test(walletAddress) &&
    SOLANA_ADDRESS_REGEX.test(walletAddress)
  ) {
    return "solana";
  }
  if (walletAddress && !stellarWalletAddress) {
    return "evm";
  }
  return "evm";
}
