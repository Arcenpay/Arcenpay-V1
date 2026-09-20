"use client";

import { useCallback, useState } from "react";
import type { ConsumeEntitlementResult } from "../sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";
import {
  useEntitlementCheck,
  invalidateEntitlementCache,
  type UseEntitlementCheckOptions,
} from "./useEntitlementCheck";

/**
 * Unified read + consume for a METERED (event/usage-based) entitlement.
 *
 * `useEntitlement`/`useFlag` answer "is this feature on?" — a boolean. Metered
 * features need a *quantity*: how much allowance the plan includes, how much
 * has been used, and how much is left. Getting that previously required
 * combining `useEntitlementCheck()` (for `allocation`/`usage`) with
 * `useConsumeEntitlement()` (for the write) and hand-wiring cache invalidation.
 * This hook is that combination, done once, correctly.
 *
 * @example
 * ```tsx
 * const { usage, allocation, remaining, exceeded, consume, loading } =
 *   useMeteredEntitlement("api_access");
 *
 * // Render a quota bar
 * <progress value={usage} max={allocation ?? undefined} />
 *
 * // Deduct one unit (e.g. per API request in your proxy route)
 * await consume();
 * ```
 *
 * NOTE ON UNITS: the platform records exactly ONE unit per consume call —
 * `POST /api/v1/usage/consume` accepts only `{ featureKey }`. There is no
 * `units`/`quantity` field, so this hook intentionally does not pretend to
 * support one. Call `consume()` N times for N units.
 */
export interface UseMeteredEntitlementReturn {
  /** Whether the entitlement is currently granted. */
  enabled: boolean;
  /** Allowance for the active billing period. `null` = unlimited. */
  allocation: number | null;
  /** Units consumed in the active billing period. */
  usage: number;
  /** `max(allocation - usage, 0)`, or `null` when unlimited. */
  remaining: number | null;
  /** True when usage has reached the allowance. */
  exceeded: boolean;
  /** True while the initial/!refreshed entitlement read is in flight. */
  loading: boolean;
  /** True while a `consume()` call is in flight. */
  consuming: boolean;
  /** Read or consume failure message. */
  error: string | null;
  /**
   * Records one unit of usage and returns the authoritative post-consume
   * quota. Throws if there is no active session or the request fails.
   */
  consume: () => Promise<ConsumeEntitlementResult>;
  /** Re-reads the entitlement from the API. */
  refresh: () => void;
}

export function useMeteredEntitlement(
  featureKey: string,
  options: UseEntitlementCheckOptions = {},
): UseMeteredEntitlementReturn {
  const { session, baseUrl } = useArcenPay();
  const check = useEntitlementCheck(featureKey, options);

  const [consuming, setConsuming] = useState(false);
  const [consumeError, setConsumeError] = useState<string | null>(null);
  /**
   * Authoritative quota returned by the most recent consume. Preferred over the
   * cached read so the meter updates immediately instead of waiting for a
   * refetch round-trip.
   */
  const [postConsume, setPostConsume] = useState<{
    allocation: number | null;
    usage: number;
    exceeded: boolean;
  } | null>(null);

  const consume = useCallback(async (): Promise<ConsumeEntitlementResult> => {
    if (!session.token) {
      throw new Error(
        "No active session. Call arcen.identify() inside <ArcenPayProvider> first.",
      );
    }

    setConsuming(true);
    setConsumeError(null);

    try {
      const response = await fetch(`${baseUrl}/api/v1/usage/consume`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ featureKey }),
      });

      const json = (await response.json().catch(() => ({}))) as
        | ConsumeEntitlementResult
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          (json as { error?: string }).error ?? `HTTP ${response.status}`,
        );
      }

      const result = json as ConsumeEntitlementResult;

      setPostConsume({
        allocation: result.allocation ?? null,
        usage: result.usage ?? 0,
        exceeded: result.exceeded ?? false,
      });

      // The read cache would otherwise re-serve pre-consume quota.
      invalidateEntitlementCache(featureKey);
      check.refetch();

      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to consume entitlement";
      setConsumeError(message);
      throw err;
    } finally {
      setConsuming(false);
    }
  }, [baseUrl, featureKey, session.token, check]);

  const allocation = postConsume?.allocation ?? check.allocation;
  const usage = postConsume?.usage ?? check.usage;

  return {
    enabled: check.enabled,
    allocation,
    usage,
    remaining: allocation === null ? null : Math.max(allocation - usage, 0),
    exceeded: postConsume?.exceeded ?? check.exceeded,
    loading: check.loading,
    consuming,
    error: consumeError ?? check.error,
    consume,
    refresh: check.refetch,
  };
}
