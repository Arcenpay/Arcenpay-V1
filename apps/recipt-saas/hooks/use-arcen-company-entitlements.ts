"use client";

import type { EntitlementResult } from "@arcenpay/react";
import { useArcenPay } from "@arcenpay/react";
import { useCallback, useEffect, useRef, useState } from "react";

type UseArcenCompanyEntitlementsOptions = {
  cacheTtlMs?: number;
  skip?: boolean;
};

type CachedEntitlements = {
  entitlements: Record<string, EntitlementResult>;
  expiresAt: number;
  updatedAt: number;
};

const cache = new Map<string, CachedEntitlements>();

export function useArcenCompanyEntitlements(
  options: UseArcenCompanyEntitlementsOptions = {},
) {
  const { session, baseUrl } = useArcenPay();
  const cacheTtlMs = options.cacheTtlMs ?? 10_000;
  const abortRef = useRef<AbortController | null>(null);

  const [entitlements, setEntitlements] = useState<
    Record<string, EntitlementResult>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const fetchEntitlements = useCallback(
    async (bustCache = false) => {
      if (options.skip || !session.token) {
        setEntitlements({});
        setLoading(false);
        setError(null);
        setUpdatedAt(null);
        return;
      }

      const cacheKey = `receipt-company-entitlements:${session.token}`;

      if (!bustCache) {
        const cached = cache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          setEntitlements(cached.entitlements);
          setUpdatedAt(cached.updatedAt);
          setLoading(false);
          setError(null);
          return;
        }
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/entitlements`, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(payload.error ?? `HTTP ${response.status}`);
        }

        const payload = (await response.json()) as
          | EntitlementResult[]
          | { entitlements: EntitlementResult[] };

        const items = Array.isArray(payload)
          ? payload
          : (payload.entitlements ?? []);

        const nextEntitlements: Record<string, EntitlementResult> = {};
        for (const item of items) {
          nextEntitlements[item.key] = item;
        }

        const fetchedAt = Date.now();
        cache.set(cacheKey, {
          entitlements: nextEntitlements,
          expiresAt: fetchedAt + cacheTtlMs,
          updatedAt: fetchedAt,
        });

        setEntitlements(nextEntitlements);
        setUpdatedAt(fetchedAt);
      } catch (cause) {
        if ((cause as Error).name === "AbortError") {
          return;
        }

        setError(
          cause instanceof Error
            ? cause.message
            : "Failed to fetch billing entitlements.",
        );
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, cacheTtlMs, options.skip, session.token],
  );

  useEffect(() => {
    void fetchEntitlements();

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchEntitlements]);

  return {
    entitlements,
    loading,
    error,
    updatedAt,
    refetch: () => fetchEntitlements(true),
  };
}
