'use client';

import { useReadContracts, useWatchBlockNumber, useWatchContractEvent } from 'wagmi';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EntitlementFreshness, EntitlementSources, PlanTier } from '@meap/core';
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
  sources: EntitlementSources;
  freshness: EntitlementFreshness;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export const ENTITLEMENT_ERROR_CODES = {
  INVALID_WALLET_ADDRESS: "INVALID_WALLET_ADDRESS",
  ONCHAIN_READ_FAILED: "ONCHAIN_READ_FAILED",
  TABLELAND_FETCH_FAILED: "TABLELAND_FETCH_FAILED",
  UNKNOWN: "UNKNOWN",
} as const;

export type EntitlementErrorCode =
  (typeof ENTITLEMENT_ERROR_CODES)[keyof typeof ENTITLEMENT_ERROR_CODES];

export class EntitlementError extends Error {
  readonly code: EntitlementErrorCode;
  readonly cause?: unknown;

  constructor(code: EntitlementErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "EntitlementError";
    this.code = code;
    this.cause = cause;
  }
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
  const ONCHAIN_STALE_AFTER_MS = 30_000;
  const { network, config } = useMEAP();
  const contracts = getContractAddresses(network.chainId);
  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;
  const lastBlockRefetchAt = useRef(0);
  const [tablelandFeatures, setTablelandFeatures] = useState<
    Record<string, boolean | string | number>
  >({});
  const [tablelandUpdatedAt, setTablelandUpdatedAt] = useState<number | null>(null);
  const [tablelandLoading, setTablelandLoading] = useState(false);
  const [tablelandError, setTablelandError] = useState<Error | null>(null);
  const walletInvalid =
    Boolean(walletAddress) && !/^0x[a-fA-F0-9]{40}$/.test(walletAddress || "");

  const tablelandFeatureFlagsUrl = useMemo(() => {
    if (!walletAddress) return null;

    const explicit = config.tablelandConfig?.featureFlagsEndpoint;
    if (explicit) {
      return explicit.includes('{wallet}')
        ? explicit.replace('{wallet}', walletAddress.toLowerCase())
        : explicit;
    }

    const providerUrl = config.tablelandConfig?.providerUrl;
    if (!providerUrl) return null;
    return `${providerUrl.replace(/\/$/, '')}/api/entitlements/${walletAddress.toLowerCase()}/flags`;
  }, [config.tablelandConfig?.featureFlagsEndpoint, config.tablelandConfig?.providerUrl, walletAddress]);

  const refetchTableland = useCallback(async () => {
    if (!tablelandFeatureFlagsUrl) {
      setTablelandFeatures({});
      setTablelandUpdatedAt(null);
      setTablelandError(null);
      return;
    }

    setTablelandLoading(true);
    setTablelandError(null);

    try {
      const response = await fetch(tablelandFeatureFlagsUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Feature flags request failed (${response.status})`);
      }

      const data = (await response.json()) as {
        ok?: boolean;
        flags?: Record<string, boolean | string | number>;
        updatedAt?: number;
        error?: string;
      };

      if (!data.ok) {
        throw new Error(data.error || 'Feature flags request failed.');
      }

      setTablelandFeatures(data.flags || {});
      setTablelandUpdatedAt(data.updatedAt || Date.now());
    } catch (err) {
      setTablelandFeatures({});
      setTablelandUpdatedAt(null);
      setTablelandError(err instanceof Error ? err : new Error('Feature flags fetch failed.'));
    } finally {
      setTablelandLoading(false);
    }
  }, [tablelandFeatureFlagsUrl]);

  useEffect(() => {
    void refetchTableland();
  }, [refetchTableland]);

  // Step 1: Get the wallet's tokenId
  const {
    data: tokenIdResult,
    isLoading: tokenIdLoading,
    refetch: refetchTokenId,
    dataUpdatedAt: tokenIdUpdatedAt,
  } = useReadContracts({
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
      staleTime: ONCHAIN_STALE_AFTER_MS,
    },
  });

  const tokenId = tokenIdResult?.[0]?.result as bigint | undefined;
  const hasToken = tokenId !== undefined && tokenId > 0n;

  // Step 2: If we have a tokenId, batch-read isValid, expiresAt, getPlanFeatures
  const {
    data: subscriptionData,
    isLoading: subLoading,
    refetch: refetchSub,
    dataUpdatedAt: subscriptionUpdatedAt,
  } = useReadContracts({
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
      staleTime: ONCHAIN_STALE_AFTER_MS,
    },
  });

  const isValid = subscriptionData?.[0]?.result as boolean | undefined;
  const expiresAt = subscriptionData?.[1]?.result as bigint | undefined;
  const planFeatures = subscriptionData?.[2]?.result as [bigint, string] | undefined;

  const planTier = planFeatures?.[1] as PlanTier | undefined;

  // Build features map from plan tier (basic tier-based features until Tableland)
  const onChainTierFeatures = useMemo<Record<string, boolean | string | number>>(() => {
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

  const features = useMemo<Record<string, boolean | string | number>>(() => {
    if (Object.keys(tablelandFeatures).length > 0) {
      return tablelandFeatures;
    }
    return onChainTierFeatures;
  }, [tablelandFeatures, onChainTierFeatures]);

  // Watch for real-time contract events to auto-refetch
  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionMinted',
    args: walletAddress
      ? ({ subscriber: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
    },
    enabled: !!walletAddress,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionRenewed',
    args: hasToken ? ({ tokenId: tokenId! } as const) : undefined,
    onLogs: () => {
      refetchSub();
      void refetchTableland();
    },
    enabled: hasToken,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'SubscriptionCancelled',
    args: hasToken ? ({ tokenId: tokenId! } as const) : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
    },
    enabled: hasToken,
  });

  // Transfer events can move subscription ownership; invalidate wallet token mapping.
  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'Transfer',
    args: walletAddress
      ? ({ to: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
    },
    enabled: !!walletAddress,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: 'Transfer',
    args: walletAddress
      ? ({ from: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
    },
    enabled: !!walletAddress,
  });

  // Block-level fallback invalidation for missed websocket events.
  useWatchBlockNumber({
    chainId: network.chainId,
    enabled: !!walletAddress,
    onBlockNumber: () => {
      const now = Date.now();
      if (now - lastBlockRefetchAt.current < 15_000) return;
      lastBlockRefetchAt.current = now;
      refetchTokenId();
      if (hasToken) refetchSub();
      void refetchTableland();
    },
  });

  const refetch = useCallback(() => {
    refetchTokenId();
    if (hasToken) refetchSub();
    void refetchTableland();
  }, [refetchTokenId, refetchSub, hasToken, refetchTableland]);

  const isLoading =
    tokenIdLoading || (hasToken && subLoading) || (Boolean(tablelandFeatureFlagsUrl) && tablelandLoading);

  const tokenError = (tokenIdResult?.[0] as { error?: unknown } | undefined)?.error;
  const subscriptionError = (subscriptionData as Array<{ error?: unknown }> | undefined)
    ?.find((entry) => entry?.error)?.error;
  const error = tokenError
      ? new EntitlementError(
          ENTITLEMENT_ERROR_CODES.ONCHAIN_READ_FAILED,
          String(tokenError),
          tokenError,
        )
    : subscriptionError
      ? new EntitlementError(
          ENTITLEMENT_ERROR_CODES.ONCHAIN_READ_FAILED,
          String(subscriptionError),
          subscriptionError,
        )
      : tablelandError
        ? new EntitlementError(
            ENTITLEMENT_ERROR_CODES.TABLELAND_FETCH_FAILED,
            tablelandError.message,
            tablelandError,
          )
        : walletInvalid
          ? new EntitlementError(
              ENTITLEMENT_ERROR_CODES.INVALID_WALLET_ADDRESS,
              "Wallet address is invalid.",
            )
          : null;

  const onChainLastUpdatedAt =
    tokenIdUpdatedAt || subscriptionUpdatedAt
      ? Math.max(tokenIdUpdatedAt || 0, subscriptionUpdatedAt || 0)
      : null;

  const sources: EntitlementSources = {
    onChain: {
      enabled: !!walletAddress,
      lastUpdatedAt: onChainLastUpdatedAt,
    },
    tableland: {
      enabled: Boolean(tablelandFeatureFlagsUrl),
      lastUpdatedAt: tablelandUpdatedAt,
    },
    lit: {
      enabled: Boolean(config.litNetwork),
      lastUpdatedAt: null,
    },
  };

  const freshness: EntitlementFreshness = {
    resolvedAt: Math.max(onChainLastUpdatedAt || 0, tablelandUpdatedAt || 0) || null,
    staleAfterMs: ONCHAIN_STALE_AFTER_MS,
  };

  return {
    isSubscribed: isValid === true,
    planTier: planTier ?? null,
    features,
    expiresAt: expiresAt ?? null,
    tokenId: hasToken ? tokenId : null,
    sources,
    freshness,
    isLoading,
    error,
    refetch,
  };
}
