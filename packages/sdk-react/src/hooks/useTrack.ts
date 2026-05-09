import { useCallback } from "react";
import type { ArcenCompanyKeys, ArcenUserKeys } from "../sdk";
import { useArcenPay } from "../providers/ArcenPayProvider";

export interface TrackEventInput {
  name: string;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Send usage/analytics events to the ArcenPay dashboard.
 * Company/user context is read from the Provider.
 *
 * @example
 * const { track } = useTrack();
 * track("page_view", { page: "/dashboard" });
 */
export function useTrack(): {
  track: (name: string, traits?: Record<string, unknown>) => Promise<void>;
} {
  const arcen = useArcenPay();
  const { session, baseUrl } = arcen;

  const track = useCallback(
    async (name: string, traits?: Record<string, unknown>) => {
      if (!session.token) {
        console.warn(
          "[useTrack] Cannot track: no session. Call arcen.identify() first.",
        );
        return;
      }

      try {
        const res = await fetch(`${baseUrl}/api/v1/events`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            event_type: "track",
            name,
            traits,
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          console.warn(`[useTrack] Failed:`, err.error);
        }
      } catch (err) {
        console.warn("[useTrack] Error:", err);
      }
    },
    [baseUrl, session.token],
  );

  return { track };
}
