"use client";

import { useCallback, useState } from "react";
import type { ConsumeEntitlementResult } from "../sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";

/**
 * Consume a metered entitlement (e.g., "api-calls").
 * Company context comes from ArcenPayProvider.
 *
 * @example
 * const { consume } = useConsumeEntitlement();
 * const result = await consume("api-calls");
 * // result = { enabled: true, consumed: true, usage: 5, limit: 100 }
 */
export function useConsumeEntitlement(): {
  consume: (featureKey: string) => Promise<ConsumeEntitlementResult>;
  loading: boolean;
  error: string | null;
} {
  const arcen = useArcenPay();
  const { session, baseUrl } = arcen;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consume = useCallback(
    async (featureKey: string) => {
      if (!session.token) {
        throw new Error(
          "No active session. Call arcen.identify() inside <ArcenPayProvider> first.",
        );
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/usage/consume`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ featureKey }),
        });

        const json = (await response.json()) as
          | ConsumeEntitlementResult
          | { error?: string };

        if (!response.ok) {
          throw new Error(
            (json as { error?: string }).error ?? `HTTP ${response.status}`,
          );
        }

        return json as ConsumeEntitlementResult;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to consume entitlement";
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, session.token],
  );

  return { consume, loading, error };
}
