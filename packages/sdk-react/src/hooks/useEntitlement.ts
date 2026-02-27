'use client';

import { useReadContracts, usePublicClient, useWatchContractEvent } from 'wagmi';
import { useCallback, useMemo } from 'react';
import type { PlanTier } from '@meap/core';
import {
  SubscriptionRegistryABI,
  getContractAddresses,
} from '@meap/core';
import { useMEAP } from '../providers/MEAPProvider';

// ============================================================
//  useEntitlement — Hook for entitlement state
//  Checks on-chain NFT validity + plan features
// ============================================================

interface UseEntitlementReturn {
  isSubscribed: boolean;
  planTier: PlanTier | null;
  features: Record<string, boolean | string | number>;
  expiresAt: bigint | null;
  tokenId: bigint | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * useEntitlement — Programmatic access to entitlement state
 *
 * Performs real on-chain reads against SubscriptionRegistry:
 * 1. getWalletSubscription(wallet) → tokenId
 * 2. isValid(tokenId)
 * 3. expiresAt(tokenId)
 * 4. getPlanFeatures(tokenId) → { planId, planTier }
 *
 * @param walletAddress - The wallet address to check
 * @param _featureKey - Optional specific feature to check (reserved for Tableland integration)
 *
 * @example
 * ```tsx
 * const { isSubscribed, planTier, expiresAt } = useEntitlement(address);
 * ```
 */
export function useEntitlement(
  walletAddress?: string,
  _featureKey?: string,
): UseEntitlementReturn {
  const { network } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;

  // Step 1: Get the wallet's tokenId
  const { data: tokenIdResult, isLoading: tokenIdLoading, refetch: refetchTokenId } = useReadContracts({
    contracts: [
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: 'getWalletSubscription',
        args: [walletAddress as `0x${string}`],
        chainId: network.chainId,
      },
    ],
    query: {
      enabled: !!walletAddress,
      staleTime: 30_000,
    },
  });

  const tokenId = tokenIdResult?.[0]?.result as bigint | undefined;
  const hasToken = tokenId !== undefined && tokenId > 0n;

  // Step 2: If we have a tokenId, batch-read isValid, expiresAt, getPlanFeatures
  const { data: subscriptionData, isLoading: subLoading, refetch: refetchSub } = useReadContracts({
    contracts: [
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: 'isValid',
        args: [tokenId!],
        chainId: network.chainId,
      },
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: 'expiresAt',
        args: [tokenId!],
        chainId: network.chainId,
      },
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: 'getPlanFeatures',
        args: [tokenId!],
        chainId: network.chainId,
      },
    ],
    query: {
      enabled: hasToken,
      staleTime: 30_000,
    },
  });

  const isValid = subscriptionData?.[0]?.result as boolean | undefined;
  const expiresAt = subscriptionData?.[1]?.result as bigint | undefined;
  const planFeatures = subscriptionData?.[2]?.result as [bigint, string] | undefined;

  const planTier = planFeatures?.[1] as PlanTier | undefined;

  // Build features map from plan tier (basic tier-based features until Tableland)
  const features = useMemo<Record<string, boolean | string | number>>(() => {
    if (!planTier) return {};
    // Basic tier-based feature mapping
    const tierFeatures: Record<string, Record<string, boolean>> = {
      starter: {
        webhook_integration: true,
      },
      pro: {
        webhook_integration: true,
        analytics_dashboard: true,
        api_access: true,
        multi_user: true,
      },
      enterprise: {
        webhook_integration: true,
        analytics_dashboard: true,
        api_access: true,
        multi_user: true,
        custom_branding: true,
        priority_support: true,
      },
    };
    return tierFeatures[planTier] || {};
  }, [planTier]);

  // Watch for real-time contract events to auto-refetch
  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionMinted',
    onLogs: () => {
      refetchTokenId();
      refetchSub();
    },
    enabled: !!walletAddress,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionRenewed',
    onLogs: () => {
      refetchSub();
    },
    enabled: hasToken,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionCancelled',
    onLogs: () => {
      refetchTokenId();
      refetchSub();
    },
    enabled: hasToken,
  });

  const refetch = useCallback(() => {
    refetchTokenId();
    if (hasToken) refetchSub();
  }, [refetchTokenId, refetchSub, hasToken]);

  const isLoading = tokenIdLoading || (hasToken && subLoading);

  const error = tokenIdResult?.[0]?.error
    ? new Error(String(tokenIdResult[0].error))
    : null;

  return {
    isSubscribed: isValid === true,
    planTier: planTier ?? null,
    features,
    expiresAt: expiresAt ?? null,
    tokenId: hasToken ? tokenId : null,
    isLoading,
    error,
    refetch,
  };
}
