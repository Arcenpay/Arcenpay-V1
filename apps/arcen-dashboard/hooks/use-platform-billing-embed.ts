"use client";

import { useState, useEffect, useCallback, useRef } from "react";

type PlatformBillingEmbed = {
  token: string;
  componentId: string;
  expiresAt: string;
};

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

/**
 * Fetches a short-lived embed access token for the platform billing portal.
 *
 * The token is cached in memory and automatically refreshed before expiry.
 * Used by the `BillingSection` to render `<ArcenEmbed />` for the team's
 * own subscription management (dogfooding).
 */
export function usePlatformBillingEmbed(): {
  token: string | null;
  componentId: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<PlatformBillingEmbed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchToken = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/platform/billing/embed-token", {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error ?? body.message ?? `Failed to fetch embed token (${res.status})`,
        );
      }

      const body = await res.json();
      const result: PlatformBillingEmbed = {
        token: body.token,
        componentId: body.componentId,
        expiresAt: body.expiresAt,
      };

      setData(result);

      // Schedule refresh before expiry
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      const expiresIn = new Date(result.expiresAt).getTime() - Date.now();
      const refreshIn = Math.max(expiresIn - REFRESH_MARGIN_MS, 30_000); // At least 30s
      refreshTimerRef.current = setTimeout(() => {
        fetchToken();
      }, refreshIn);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchToken();
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [fetchToken]);

  return {
    token: data?.token ?? null,
    componentId: data?.componentId ?? null,
    loading,
    error,
    refresh: fetchToken,
  };
}
