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

export function getOnboardingChainFamily(): ChainFamily | null {
  if (typeof window === "undefined") return null;
  try {
    // 1. Check localStorage
    const local = localStorage.getItem(CHAIN_FAMILY_KEY) as ChainFamily | null;
    if (local === "evm" || local === "stellar") return local;

    // 2. Check sessionStorage
    const session = sessionStorage.getItem(CHAIN_FAMILY_KEY) as ChainFamily | null;
    if (session === "evm" || session === "stellar") return session;

    // 3. Check Cookie
    const cookieVal = getCookie(CHAIN_FAMILY_KEY) as ChainFamily | null;
    if (cookieVal === "evm" || cookieVal === "stellar") return cookieVal;

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
 * Resolves the effective chain family considering stored preference and linked wallet addresses.
 * Defaults to "evm" if ambiguous.
 */
export function resolveEffectiveChainFamily(
  storedFamily?: ChainFamily | null,
  walletAddress?: string | null,
  stellarWalletAddress?: string | null,
): ChainFamily {
  if (storedFamily === "evm" || storedFamily === "stellar") {
    return storedFamily;
  }
  if (walletAddress && !stellarWalletAddress) {
    return "evm";
  }
  if (stellarWalletAddress && !walletAddress) {
    return "stellar";
  }
  return "evm";
}
