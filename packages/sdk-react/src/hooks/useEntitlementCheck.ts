"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { EntitlementResult } from "../sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";
import { warnOnUnknownFeatureKey } from "../lib/feature-key-diagnostics";

export interface UseEntitlementCheckOptions {
  cacheTtlMs?: number;
}

export interface UseEntitlementCheckReturn extends Partial<EntitlementResult> {
  enabled: boolean;
  /** Maximum allowed usage for the active billing period. `null` = unlimited. */
  allocation: number | null;
  /** Units consumed in the active billing period. */
  usage: number;
  /**
   * Units still available: `max(allocation - usage, 0)`.
   * `null` when the entitlement is unlimited (`allocation === null`), so callers
   * can distinguish "no limit" from "none left".
   */
  remaining: number | null;
  exceeded: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const cache = new Map<
  string,
  { result: EntitlementResult; expiresAt: number }
>();

/**
 * Drops cached entitlement reads.
 *
 * MUST be called after anything that mutates usage (e.g. `consume()`).
 * Otherwise `refetch()` returns the still-fresh cached value and the UI shows
 * the pre-consume quota until the TTL expires — the classic "my meter never
 * moves" bug.
 *
 * @param featureKey clear only this key's entries; omit to clear everything.
 */
export function invalidateEntitlementCache(featureKey?: string): void {
  if (!featureKey) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.endsWith(`:${featureKey}`)) cache.delete(key);
  }
}

export function useEntitlementCheck(
  featureKey: string,
  options: UseEntitlementCheckOptions = {},
): UseEntitlementCheckReturn {
  const { session, baseUrl } = useArcenPay();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const [result, setResult] = useState<EntitlementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlement = useCallback(async () => {
    if (!session.token) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }

    const cacheKey = `entitlement:${session.token}:${featureKey}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      setResult(cached.result);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const url = new URL(`${baseUrl}/api/v1/check`);
      url.searchParams.set("key", featureKey);

      const res = await fetch(url.toString(), {
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

      const json = (await res.json()) as EntitlementResult;
      warnOnUnknownFeatureKey(featureKey, json.reason);
      cache.set(cacheKey, { result: json, expiresAt: Date.now() + cacheTtlMs });
      setResult(json);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [session.token, featureKey, baseUrl, cacheTtlMs]);

  useEffect(() => {
    fetchEntitlement();
    return () => abortRef.current?.abort();
  }, [fetchEntitlement]);

  const allocation = result?.allocation ?? null;
  const usage = result?.usage ?? 0;

  return {
    key: result?.key ?? featureKey,
    enabled: result?.enabled ?? false,
    reason: result?.reason,
    allocation,
    usage,
    // `null` allocation means unlimited, which must not be reported as 0
    // remaining — that would render "0 left" for an uncapped entitlement.
    remaining: allocation === null ? null : Math.max(allocation - usage, 0),
    exceeded: result?.exceeded ?? false,
    loading,
    error,
    refetch: fetchEntitlement,
  };
}
