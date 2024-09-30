"use client";

import {
  useReadContracts,
  useWatchBlockNumber,
  useWatchContractEvent,
} from "wagmi";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EntitlementFreshness,
  EntitlementSources,
  PlanTier,
} from "../sdk";
import { SubscriptionRegistryABI, getContractAddresses } from "../sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";
import { useCompanyEntitlements } from "./useCompanyEntitlements";
import { entitlementsToFeatures } from "../lib/api";

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
  DASHBOARD_FETCH_FAILED: "DASHBOARD_FETCH_FAILED",
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
 * 2. hasActiveSubscription(wallet) → confirm the mapping still points to a live token
 * 3. isValid(tokenId)
 * 4. expiresAt(tokenId)
 * 5. getPlanFeatures(tokenId) → { planId, planTier }
 *
 * Feature values are resolved with this precedence:
 * 1. dashboard company entitlements when an Arcen session token is available
 * 2. wallet/provider compatibility endpoint
 * 3. on-chain tierFeatureFallback
 *
 * When featureKey is provided, the resolved features map is filtered to that
 * single key — useful for lightweight gating checks.
 *
 * @param walletAddress - The wallet address to check
 * @param featureKey - Optional: restrict resolved features to this single key
 *
 * @example
 * ```tsx
 * const { isSubscribed, planTier, expiresAt } = useEntitlement(address);
 * const { features } = useEntitlement(address, 'analytics_dashboard');
 * ```
 */
export function useEntitlement(
  walletAddress?: string,
  featureKey?: string,
): UseEntitlementReturn {
  const ONCHAIN_STALE_AFTER_MS = 30_000;
  const { network, config } = useArcenPay();
  const contracts = getContractAddresses(network.chainId);
  const registryAddress = contracts.subscriptionRegistry as `0x${string}`;
  const lastBlockRefetchAt = useRef(0);
  const {
    entitlements: dashboardEntitlements,
    updatedAt: dashboardUpdatedAt,
    loading: dashboardLoading,
    error: dashboardError,
    refetch: refetchDashboardEntitlements,
  } = useCompanyEntitlements({
    skip: false,
  });
  const [tablelandFeatures, setTablelandFeatures] = useState<
    Record<string, boolean | string | number>
  >({});
  const [tablelandUpdatedAt, setTablelandUpdatedAt] = useState<number | null>(
    null,
  );
  const [tablelandLoading, setTablelandLoading] = useState(false);
  const [tablelandError, setTablelandError] = useState<Error | null>(null);
  // EVM hex is case-insensitive; Solana base58 is case-sensitive and must be
  // preserved. Only lowercase the EVM shape.
  const normalizedWallet =
    walletAddress && walletAddress.startsWith("0x")
      ? walletAddress.toLowerCase()
      : walletAddress;
  // Accept both EVM (20-byte hex) and Solana (base58) wallet shapes — a Solana
  // wallet must not be flagged invalid.
  const walletInvalid =
    Boolean(walletAddress) &&
    !/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(walletAddress || "");

  const tablelandFeatureFlagsUrl = useMemo(() => {
    if (!normalizedWallet) return null;

    const explicit = config.tablelandConfig?.featureFlagsEndpoint;
    if (explicit) {
      return explicit.includes("{wallet}")
        ? explicit.replace("{wallet}", normalizedWallet)
        : explicit;
    }

    const providerUrl = config.tablelandConfig?.providerUrl;
    if (!providerUrl) return null;
    return `${providerUrl.replace(/\/$/, "")}/api/entitlements/${normalizedWallet}/flags`;
  }, [
    config.tablelandConfig?.featureFlagsEndpoint,
    config.tablelandConfig?.providerUrl,
    walletAddress,
  ]);

  const sequenceRef = useRef(0);

  const refetchTableland = useCallback(async () => {
    if (!tablelandFeatureFlagsUrl) {
      setTablelandFeatures({});
      setTablelandUpdatedAt(null);
      setTablelandError(null);
      return;
    }

    const seq = ++sequenceRef.current;
    setTablelandLoading(true);
    setTablelandError(null);

    try {
      const response = await fetch(tablelandFeatureFlagsUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
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
        throw new Error(data.error || "Feature flags request failed.");
      }

      if (sequenceRef.current !== seq) return;
      setTablelandFeatures(data.flags || {});
      setTablelandUpdatedAt(data.updatedAt || Date.now());
    } catch (err) {
      if (sequenceRef.current !== seq) return;
      setTablelandFeatures({});
      setTablelandUpdatedAt(null);
      setTablelandError(
        err instanceof Error ? err : new Error("Feature flags fetch failed."),
      );
    } finally {
      if (sequenceRef.current === seq) {
        setTablelandLoading(false);
      }
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
        functionName: "getWalletSubscription",
        args: [walletAddress as `0x${string}`],
        chainId: network.chainId,
      },
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "hasActiveSubscription",
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
  const hasActiveSubscription = tokenIdResult?.[1]?.result as
    | boolean
    | undefined;
  const hasToken =
    tokenId !== undefined && tokenId > 0n && hasActiveSubscription === true;

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
        functionName: "isValid",
        args: [tokenId!],
        chainId: network.chainId,
      },
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "expiresAt",
        args: [tokenId!],
        chainId: network.chainId,
      },
      {
        address: registryAddress,
        abi: SubscriptionRegistryABI,
        functionName: "getPlanFeatures",
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
  const planFeatures = subscriptionData?.[2]?.result as
    | [bigint, string]
    | undefined;

  const planTier = planFeatures?.[1] as PlanTier | undefined;

  // Build features map from plan tier. Uses provider-supplied `tierFeatureFallback`
  // from ArcenPayProvider config when Tableland is not configured, falling back to an
  // empty map so custom provider feature keys are never silently replaced.
  const onChainTierFeatures = useMemo<
    Record<string, boolean | string | number>
  >(() => {
    if (!planTier) return {};
    const fallback = config.tierFeatureFallback;
    if (fallback) {
      return (
        (fallback[planTier] as
          | Record<string, boolean | string | number>
          | undefined) ?? {}
      );
    }
    return {};
  }, [planTier, config.tierFeatureFallback]);

  const dashboardFeatures = useMemo<Record<string, boolean | string | number>>(
    () => entitlementsToFeatures(dashboardEntitlements),
    [dashboardEntitlements],
  );

  const features = useMemo<Record<string, boolean | string | number>>(() => {
    const allFeatures = {
      ...onChainTierFeatures,
      ...tablelandFeatures,
      ...dashboardFeatures,
    };
    if (featureKey) {
      const value = allFeatures[featureKey];
      return value !== undefined ? { [featureKey]: value } : {};
    }
    return allFeatures;
  }, [dashboardFeatures, tablelandFeatures, onChainTierFeatures, featureKey]);

  // Watch for real-time contract events to auto-refetch
  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: "SubscriptionMinted",
    args: walletAddress
      ? ({ subscriber: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
      void refetchDashboardEntitlements();
    },
    enabled: !!walletAddress,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: "SubscriptionRenewed",
    args: hasToken ? ({ tokenId: tokenId! } as const) : undefined,
    onLogs: () => {
      refetchSub();
      void refetchTableland();
      void refetchDashboardEntitlements();
    },
    enabled: hasToken,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: "SubscriptionCancelled",
    args: hasToken ? ({ tokenId: tokenId! } as const) : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
      void refetchDashboardEntitlements();
    },
    enabled: hasToken,
  });

  // Transfer events can move subscription ownership; invalidate wallet token mapping.
  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: "Transfer",
    args: walletAddress
      ? ({ to: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
      void refetchDashboardEntitlements();
    },
    enabled: !!walletAddress,
  });

  useWatchContractEvent({
    address: registryAddress,
    abi: SubscriptionRegistryABI,
    eventName: "Transfer",
    args: walletAddress
      ? ({ from: walletAddress as `0x${string}` } as const)
      : undefined,
    onLogs: () => {
      refetchTokenId();
      refetchSub();
      void refetchTableland();
      void refetchDashboardEntitlements();
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
      void refetchDashboardEntitlements();
    },
  });

  const refetch = useCallback(() => {
    refetchTokenId();
    if (hasToken) refetchSub();
    void refetchTableland();
    void refetchDashboardEntitlements();
  }, [
    refetchTokenId,
    refetchSub,
    hasToken,
    refetchTableland,
    refetchDashboardEntitlements,
  ]);

  const isLoading =
    tokenIdLoading ||
    (hasToken && subLoading) ||
    dashboardLoading ||
    (Boolean(tablelandFeatureFlagsUrl) && tablelandLoading);

  const tokenError = (tokenIdResult?.[0] as { error?: unknown } | undefined)
    ?.error;
  const subscriptionError = (
    subscriptionData as Array<{ error?: unknown }> | undefined
  )?.find((entry) => entry?.error)?.error;
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
        : dashboardError
          ? new EntitlementError(
              ENTITLEMENT_ERROR_CODES.DASHBOARD_FETCH_FAILED,
              dashboardError,
              dashboardError,
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
      enabled:
        Boolean(tablelandFeatureFlagsUrl) ||
        Object.keys(dashboardEntitlements).length > 0,
      lastUpdatedAt:
        Math.max(tablelandUpdatedAt || 0, dashboardUpdatedAt || 0) || null,
    },
    lit: {
      enabled: Boolean(config.litNetwork),
      lastUpdatedAt: null,
    },
  };

  const freshness: EntitlementFreshness = {
    resolvedAt:
      Math.max(
        onChainLastUpdatedAt || 0,
        tablelandUpdatedAt || 0,
        dashboardUpdatedAt || 0,
      ) || null,
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
