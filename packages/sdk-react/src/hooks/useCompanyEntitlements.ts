"use client";

/**
 * useCompanyEntitlements — React hook for fetching all entitlements for a company.
 *
 * Calls GET /api/v1/entitlements with the current access token and returns
 * every feature flag + allocation the company is entitled to, in a single request.
 * Results are cached for 30 seconds.
 *
 * @example
 * const { entitlements, loading, error } = useCompanyEntitlements()
 *
 * // Check a specific feature
 * const canExport = entitlements['analytics_export']?.enabled ?? false
 * const apiLimit  = entitlements['api_calls_limit']?.allocation ?? 0
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { EntitlementResult } from "../sdk";
import { resolveDashboardBaseUrl } from "../lib/api";
import { useArcenPay } from "../providers/ArcenPayProvider";

export interface UseCompanyEntitlementsOptions {
  /** Base URL for the ArcenPay dashboard API (defaults to production) */
  baseUrl?: string;
  /** Cache duration in ms (default: 30_000) */
  cacheTtlMs?: number;
  /** Skip the fetch entirely (returns empty entitlements) */
  skip?: boolean;
}

export interface UseCompanyEntitlementsReturn {
  /** All entitlements keyed by feature flag key */
  entitlements: Record<string, EntitlementResult>;
  /** Timestamp of the last successful entitlement resolution */
  updatedAt: number | null;
  /** True while the initial fetch is in progress */
  loading: boolean;
  /** Error message if the fetch failed */
  error: string | null;
  /** Manually re-fetch entitlements (bypasses cache) */
  refetch: () => void;
}

// Module-level cache: accessToken → { entitlements, expiresAt }
const cache = new Map<
  string,
  {
    entitlements: Record<string, EntitlementResult>;
    expiresAt: number;
    updatedAt: number;
  }
>();

export function useCompanyEntitlements(
  options: UseCompanyEntitlementsOptions = {},
): UseCompanyEntitlementsReturn {
  const { session, baseUrl: providerBaseUrl } = useArcenPay();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const baseUrl = resolveDashboardBaseUrl(options.baseUrl ?? providerBaseUrl);

  const [entitlements, setEntitlements] = useState<
    Record<string, EntitlementResult>
  >({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlements = useCallback(
    async (bustCache = false) => {
      if (options.skip || !session.token) {
        setUpdatedAt(null);
        setLoading(false);
        return;
      }

      const cacheKey = `company_entitlements:${session.token}`;

      if (!bustCache) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
          setEntitlements(cached.entitlements);
          setUpdatedAt(cached.updatedAt);
          setLoading(false);
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`${baseUrl}/api/v1/entitlements`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(
            (json as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        // API returns array of EntitlementResult — convert to map keyed by `key`
        const json = (await res.json()) as
          | EntitlementResult[]
          | { entitlements: EntitlementResult[] };
        const list: EntitlementResult[] = Array.isArray(json)
          ? json
          : (json.entitlements ?? []);

        const map: Record<string, EntitlementResult> = {};
        for (const item of list) {
          if (item.key) map[item.key] = item;
        }

        const fetchedAt = Date.now();
        cache.set(cacheKey, {
          entitlements: map,
          expiresAt: fetchedAt + cacheTtlMs,
          updatedAt: fetchedAt,
        });
        setEntitlements(map);
        setUpdatedAt(fetchedAt);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [session.token, baseUrl, cacheTtlMs, options.skip],
  );

  useEffect(() => {
    fetchEntitlements();
    return () => abortRef.current?.abort();
  }, [fetchEntitlements]);

  return {
    entitlements,
    updatedAt,
    loading,
    error,
    refetch: () => fetchEntitlements(true),
  };
}
