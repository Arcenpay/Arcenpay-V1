"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useArcenSession } from "../providers/MEAPProvider";
import type { EntitlementResult } from "@arcenpay/sdk";

export interface UseEntitlementCheckOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
}

export interface UseEntitlementCheckReturn extends Partial<EntitlementResult> {
  enabled: boolean;
  allocation: number | null;
  usage: number;
  exceeded: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const cache = new Map<string, { result: EntitlementResult; expiresAt: number }>();

export function useEntitlementCheck(
  featureKey: string,
  options: UseEntitlementCheckOptions = {},
): UseEntitlementCheckReturn {
  const session = useArcenSession();
  const cacheTtlMs = options.cacheTtlMs ?? 30_000;

  const baseUrl =
    options.baseUrl ??
    (typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ARCEN_BASE_URL : undefined) ??
    "https://dashboard.arcenpay.xyz";

  const [result, setResult] = useState<EntitlementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchEntitlement = useCallback(async () => {
    if (!session.token) {
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
        signal: controller.signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const json = (await res.json()) as EntitlementResult;
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

  return {
    key: result?.key ?? featureKey,
    enabled: result?.enabled ?? false,
    reason: result?.reason,
    allocation: result?.allocation ?? null,
    usage: result?.usage ?? 0,
    exceeded: result?.exceeded ?? false,
    loading,
    error,
    refetch: fetchEntitlement,
  };
}
