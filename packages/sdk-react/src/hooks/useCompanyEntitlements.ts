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
import { useArcenPay } from "../providers/ArcenPayProvider";

export interface CompanyKeys {
  id?: string;
  wallet?: string;
  email?: string;
}

export interface UseCompanyEntitlementsOptions {
  /** Cache duration in ms (default: 30_000) */
  cacheTtlMs?: number;
  /** Skip the fetch entirely (returns empty entitlements) */
  skip?: boolean;
  /**
   * Company identity for publishable-key reads. When no identify() session
   * token exists, the hook authenticates with the configured publishable key
   * (pk_live_/pk_test_) plus these keys via X-Arcen-Company-Keys.
   */
  companyKeys?: CompanyKeys | null;
}

function serializeCompanyKeys(keys: CompanyKeys): string {
  return ["id", "wallet", "email"]
    .map((key) => {
      const value = keys[key as keyof CompanyKeys]?.trim();
      return value ? `${key}=${value}` : "";
    })
    .filter(Boolean)
    .join(",");
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
  const { session, baseUrl, publishableKey } = useArcenPay();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;
  const companyKeysValue = serializeCompanyKeys(options.companyKeys ?? {});

  const [entitlements, setEntitlements] = useState<
    Record<string, EntitlementResult>
  >({});
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlements = useCallback(
    async (bustCache = false) => {
      // Publishable-key mode: no session token, but a pk_ + company keys let
      // us read entitlements client-side (the backend accepts publishable
      // keys and resolves the company from X-Arcen-Company-Keys).
      const canUsePublishable =
        !session.token && Boolean(publishableKey && companyKeysValue);
      if (options.skip || (!session.token && !canUsePublishable)) {
        setEntitlements({});
        setUpdatedAt(null);
        setError(null);
        setLoading(false);
        return;
      }

      const authToken = session.token ?? (canUsePublishable ? publishableKey : null);
      const cacheKey = canUsePublishable
        ? `company_entitlements:pk:${companyKeysValue}`
        : `company_entitlements:${session.token}`;

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
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
        if (canUsePublishable && companyKeysValue) {
          headers["X-Arcen-Company-Keys"] = companyKeysValue;
        }
        const res = await fetch(`${baseUrl}/api/v1/entitlements`, {
          headers,
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
    [session.token, baseUrl, cacheTtlMs, options.skip, publishableKey, companyKeysValue],
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
