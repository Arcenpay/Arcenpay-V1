'use client';

import { useState, useEffect, useCallback } from 'react';
import type { PlanTier, Entitlement } from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  useEntitlement — Hook for entitlement state
//  Checks on-chain NFT validity + Tableland feature flags
// ============================================================

interface UseEntitlementReturn {
  isSubscribed: boolean;
  planTier: PlanTier | null;
  features: Record<string, boolean | string | number>;
  expiresAt: bigint | null;
  tokenId: bigint | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * useEntitlement — Programmatic access to entitlement state
 *
 * @param walletAddress - The wallet address to check
 * @param featureKey - Optional specific feature to check
 *
 * @example
 * ```tsx
 * const { isSubscribed, planTier, features, expiresAt } = useEntitlement(address);
 * ```
 */
export function useEntitlement(
  walletAddress?: string,
  featureKey?: string,
): UseEntitlementReturn {
  const { contracts, network } = useMEAP();
  const [state, setState] = useState<{
    isSubscribed: boolean;
    planTier: PlanTier | null;
    features: Record<string, boolean | string | number>;
    expiresAt: bigint | null;
    tokenId: bigint | null;
    isLoading: boolean;
    error: Error | null;
  }>({
    isSubscribed: false,
    planTier: null,
    features: {},
    expiresAt: null,
    tokenId: null,
    isLoading: true,
    error: null,
  });

  const fetchEntitlement = useCallback(async () => {
    if (!walletAddress) {
      setState((prev) => ({ ...prev, isLoading: false }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      // TODO: Implement full on-chain query flow:
      // 1. Call SubscriptionRegistry.getWalletSubscription(walletAddress)
      // 2. If tokenId > 0, call SubscriptionRegistry.isValid(tokenId)
      // 3. Call SubscriptionRegistry.expiresAt(tokenId)
      // 4. Call SubscriptionRegistry.getPlanFeatures(tokenId)
      // 5. Query Tableland for feature flags
      // 6. Optionally, check Lit Protocol ACCs

      // For now, return default state
      setState({
        isSubscribed: false,
        planTier: null,
        features: {},
        expiresAt: null,
        tokenId: null,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err instanceof Error ? err : new Error(err.message),
      }));
    }
  }, [walletAddress, contracts, network]);

  useEffect(() => {
    fetchEntitlement();
  }, [fetchEntitlement]);

  // TODO: Subscribe to contract events for real-time updates
  // - SubscriptionMinted
  // - SubscriptionRenewed
  // - SubscriptionCancelled

  return {
    ...state,
    refetch: fetchEntitlement,
  };
}
