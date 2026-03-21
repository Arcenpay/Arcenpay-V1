/**
 * useFlag — React hook for checking a single feature flag.
 *
 * Calls GET /api/v1/flags/check?key=<featureKey> with company/user keys.
 * Results are cached for 30 seconds and revalidated automatically.
 *
 * @example
 * const { value, loading, reason } = useFlag(
 *   'scan',
 *   { wallet: '0x...' },
 *   { clerkUserId: 'user_xxx' }
 * );
 * if (value) { // user has access }
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { FlagCheckResult, SchematicCompanyKeys, SchematicUserKeys } from '@meap/core';

interface UseFlagOptions {
  /** Base URL for the ArcenPay dashboard API (defaults to '') */
  baseUrl?: string;
  /** API key for server-side usage (omit for client-side — use access token instead) */
  apiKey?: string;
  /** Cache duration in ms (default: 30_000) */
  cacheMs?: number;
  /** Whether to skip the flag check (returns null value) */
  skip?: boolean;
}

interface UseFlagResult {
  value: boolean | null;
  loading: boolean;
  reason: string;
  error: string | null;
  refetch: () => void;
}

// Simple module-level cache: key → { result, expiresAt }
const flagCache = new Map<string, { result: FlagCheckResult; expiresAt: number }>();

function buildCacheKey(
  featureKey: string,
  companyKeys: SchematicCompanyKeys,
  userKeys?: SchematicUserKeys,
): string {
  return `${featureKey}:${JSON.stringify(companyKeys)}:${JSON.stringify(userKeys ?? {})}`;
}

export function useFlag(
  featureKey: string,
  companyKeys: SchematicCompanyKeys,
  userKeys?: SchematicUserKeys,
  options: UseFlagOptions = {},
): UseFlagResult {
  const { baseUrl = '', apiKey, cacheMs = 30_000, skip = false } = options;

  const [result, setResult] = useState<FlagCheckResult | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => {
    const cacheKey = buildCacheKey(featureKey, companyKeys, userKeys);
    flagCache.delete(cacheKey);
    setTick((t) => t + 1);
  }, [featureKey, companyKeys, userKeys]);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (skip || !featureKey) {
      setLoading(false);
      return;
    }

    const cacheKey = buildCacheKey(featureKey, companyKeys, userKeys);
    const cached = flagCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      setResult(cached.result);
      setLoading(false);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);

    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    // Encode company keys as header
    const companyKeyParts: string[] = [];
    if (companyKeys.id) companyKeyParts.push(`id=${companyKeys.id}`);
    if (companyKeys.wallet) companyKeyParts.push(`wallet=${companyKeys.wallet}`);
    if (companyKeys.email) companyKeyParts.push(`email=${companyKeys.email}`);
    if (companyKeyParts.length > 0) {
      headers['X-Arcen-Company-Keys'] = companyKeyParts.join(',');
    }

    if (userKeys) {
      const userKeyParts: string[] = [];
      if (userKeys.id) userKeyParts.push(`id=${userKeys.id}`);
      if (userKeys.clerkUserId) userKeyParts.push(`clerk_user_id=${userKeys.clerkUserId}`);
      if (userKeys.wallet) userKeyParts.push(`wallet=${userKeys.wallet}`);
      if (userKeyParts.length > 0) {
        headers['X-Arcen-User-Keys'] = userKeyParts.join(',');
      }
    }

    fetch(`${baseUrl}/api/v1/flags/check?key=${encodeURIComponent(featureKey)}`, {
      headers,
      signal: ctrl.signal,
    })
      .then((res) => res.json())
      .then((data: { data?: FlagCheckResult; error?: string }) => {
        if (data.data) {
          flagCache.set(cacheKey, { result: data.data, expiresAt: Date.now() + cacheMs });
          setResult(data.data);
          setError(null);
        } else {
          setError(data.error ?? 'Flag check failed');
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureKey, JSON.stringify(companyKeys), JSON.stringify(userKeys), skip, tick]);

  return {
    value: result?.value ?? null,
    loading,
    reason: result?.reason ?? '',
    error,
    refetch,
  };
}

/**
 * useFlags — Check multiple flags at once.
 */
export function useFlags(
  featureKeys: string[],
  companyKeys: SchematicCompanyKeys,
  userKeys?: SchematicUserKeys,
  options: UseFlagOptions = {},
): { flags: Record<string, boolean | null>; loading: boolean } {
  const [flags, setFlags] = useState<Record<string, boolean | null>>({});
  const [loading, setLoading] = useState(true);

  const { baseUrl = '', apiKey, skip = false } = options;

  useEffect(() => {
    if (skip || featureKeys.length === 0) {
      setLoading(false);
      return;
    }

    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const companyKeyParts: string[] = [];
    if (companyKeys.id) companyKeyParts.push(`id=${companyKeys.id}`);
    if (companyKeys.wallet) companyKeyParts.push(`wallet=${companyKeys.wallet}`);
    if (companyKeys.email) companyKeyParts.push(`email=${companyKeys.email}`);
    if (companyKeyParts.length > 0) headers['X-Arcen-Company-Keys'] = companyKeyParts.join(',');

    Promise.all(
      featureKeys.map((key) =>
        fetch(`${baseUrl}/api/v1/flags/check?key=${encodeURIComponent(key)}`, { headers })
          .then((r) => r.json() as Promise<{ data?: FlagCheckResult }>)
          .then((d) => [key, d.data?.value ?? null] as [string, boolean | null])
          .catch(() => [key, null] as [string, null]),
      ),
    )
      .then((results) => {
        setFlags(Object.fromEntries(results));
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureKeys.join(','), JSON.stringify(companyKeys), skip]);

  return { flags, loading };
}
