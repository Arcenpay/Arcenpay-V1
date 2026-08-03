"use client";

import type { ChainFamily } from "@arcenpay/internal-core";

const CHAIN_FAMILY_KEY = "arcenpay_onboarding_chain_family";

export function getOnboardingChainFamily(): ChainFamily | null {
  if (typeof window === "undefined") return null;
  try {
    return (sessionStorage.getItem(CHAIN_FAMILY_KEY) as ChainFamily) ?? null;
  } catch {
    return null;
  }
}

export function setOnboardingChainFamily(family: ChainFamily) {
  try {
    sessionStorage.setItem(CHAIN_FAMILY_KEY, family);
  } catch {
    // ignore
  }
}
