import { useState, useEffect, useCallback, useRef } from "react";
import type { ArcenCompanyKeys, ArcenUserKeys } from "@arcenpay/sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";
import { resolveDashboardBaseUrl } from "../lib/api";

// ─── Module-level cache ──────────────────────────────────────────────────────

interface CachedFlag {
  enabled: boolean;
  reason: string;
  expiresAt: number;
}

const flagCache = new Map<string, CachedFlag>();

// ─── Hook: useFlag ───────────────────────────────────────────────────────────

/**
 * Check a single feature flag.
 *
 * @example
 * // Inside <ArcenPayProvider> with company identified
 * const isEnabled = useFlag("premium-features");
 */
export function useFlag(featureKey: string): boolean;
/** @deprecated Pass companyKeys via ArcenPayProvider.identify() instead. */
export function useFlag(
  featureKey: string,
  companyKeys: ArcenCompanyKeys,
  userKeys?: ArcenUserKeys,
): boolean;
export function useFlag(
  featureKey: string,
  companyKeys?: ArcenCompanyKeys,
  userKeys?: ArcenUserKeys,
): boolean {
  const arcen = useArcenPay();
  const { session } = arcen;

  const company = companyKeys ?? session.company ?? undefined;
  const user = userKeys ?? session.user ?? undefined;
  const token = session.token;
  const baseUrl = resolveDashboardBaseUrl();

  const cacheKey = `${featureKey}:${JSON.stringify(company ?? {})}:${JSON.stringify(user ?? {})}`;

  const [enabled, setEnabled] = useState<boolean>(() => {
    const cached = flagCache.get(cacheKey);
    return cached && Date.now() < cached.expiresAt ? cached.enabled : false;
  });

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!featureKey) return;

    const cached = flagCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      setEnabled(cached.enabled);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    fetch(`${baseUrl}/api/v1/check?key=${encodeURIComponent(featureKey)}`, {
      headers,
      signal: ctrl.signal,
    })
      .then((res) => res.json())
      .then((json: { enabled?: boolean; reason?: string }) => {
        const value = json.enabled ?? false;
        flagCache.set(cacheKey, {
          enabled: value,
          reason: (json as { reason?: string }).reason ?? "",
          expiresAt: Date.now() + 30_000,
        });
        setEnabled(value);
      })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("[useFlag]", err);
        }
      });

    return () => ctrl.abort();
  }, [featureKey, cacheKey, token, baseUrl]);

  return enabled;
}

// ─── Hook: useFlags ──────────────────────────────────────────────────────────

/**
 * Check multiple feature flags at once.
 *
 * @example
 * const flags = useFlags(["premium", "beta", "api-access"]);
 * // flags = { premium: true, beta: false, "api-access": true }
 */
export function useFlags(featureKeys: string[]): Record<string, boolean>;
/** @deprecated Pass companyKeys via ArcenPayProvider.identify() instead. */
export function useFlags(
  featureKeys: string[],
  companyKeys: ArcenCompanyKeys,
  userKeys?: ArcenUserKeys,
): Record<string, boolean>;
export function useFlags(
  featureKeys: string[],
  companyKeys?: ArcenCompanyKeys,
  userKeys?: ArcenUserKeys,
): Record<string, boolean> {
  const arcen = useArcenPay();
  const { session } = arcen;

  const company = companyKeys ?? session.company ?? undefined;
  const user = userKeys ?? session.user ?? undefined;
  const token = session.token;
  const baseUrl = resolveDashboardBaseUrl();

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (featureKeys.length === 0) return;

    const ctrl = new AbortController();
    controllerRef.current = ctrl;

    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    Promise.all(
      featureKeys.map((key) =>
        fetch(`${baseUrl}/api/v1/check?key=${encodeURIComponent(key)}`, {
          headers,
          signal: ctrl.signal,
        })
          .then((r) => r.json() as Promise<{ enabled?: boolean }>)
          .then((json) => [key, json.enabled ?? false] as [string, boolean])
          .catch(() => [key, false] as [string, boolean]),
      ),
    ).then((results) => {
      setFlags(Object.fromEntries(results));
    });

    return () => {
      controllerRef.current?.abort();
    };
  }, [featureKeys.join(","), token, baseUrl]);

  return flags;
}
