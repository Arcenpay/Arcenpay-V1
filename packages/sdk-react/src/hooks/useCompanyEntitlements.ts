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
import { useArcenSession } from "../providers/MEAPProvider";
import type { EntitlementResult } from "@arcenpay/sdk";

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
  /** True while the initial fetch is in progress */
  loading: boolean;
  /** Error message if the fetch failed */
  error: string | null;
  /** Manually re-fetch entitlements (bypasses cache) */
  refetch: () => void;
}

// Module-level cache: accessToken → { entitlements, expiresAt }
const cache = new Map<string, { entitlements: Record<string, EntitlementResult>; expiresAt: number }>();

export function useCompanyEntitlements(
  options: UseCompanyEntitlementsOptions = {},
): UseCompanyEntitlementsReturn {
  const session = useArcenSession();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const baseUrl =
    options.baseUrl ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ARCEN_BASE_URL : undefined) ??
    "https://dashboard.arcenpay.xyz";

  const [entitlements, setEntitlements] = useState<Record<string, EntitlementResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlements = useCallback(
    async (bustCache = false) => {
      if (options.skip || !session.token) {
        setLoading(false);
        return;
      }

      const cacheKey = `company_entitlements:${session.token}`;

      if (!bustCache) {
        const cached = cache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
          setEntitlements(cached.entitlements);
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
          signal: controller.signal,
        });

        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
        }

        // API returns array of EntitlementResult — convert to map keyed by `key`
        const json = (await res.json()) as EntitlementResult[] | { entitlements: EntitlementResult[] };
        const list: EntitlementResult[] = Array.isArray(json) ? json : (json.entitlements ?? []);

        const map: Record<string, EntitlementResult> = {};
        for (const item of list) {
          if (item.key) map[item.key] = item;
        }

        cache.set(cacheKey, { entitlements: map, expiresAt: Date.now() + cacheTtlMs });
        setEntitlements(map);
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
    loading,
    error,
    refetch: () => fetchEntitlements(true),
  };
}
