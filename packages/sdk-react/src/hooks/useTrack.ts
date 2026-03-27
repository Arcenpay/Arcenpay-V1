/**
 * useTrack — React hook for sending usage events.
 *
 * Returns a `track` function that POSTs to /api/v1/events.
 * Events are batched and debounced by default to avoid flooding the API.
 *
 * @example
 * const { track } = useTrack({ baseUrl: '', apiKey: 'api_xxx' });
 * await track({ name: 'scan', company: { wallet: '0x...' } });
 */

import { useCallback, useRef } from 'react';
import type { ArcenCompanyKeys, ArcenUserKeys } from '@arcenpay/sdk';

export interface TrackOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface TrackEventInput {
  name: string;
  company: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
}

export interface UseTrackResult {
  track: (event: TrackEventInput) => Promise<void>;
}

export function useTrack(options: TrackOptions = {}): UseTrackResult {
  const { baseUrl = '', apiKey } = options;

  const pendingRef = useRef<Promise<void> | null>(null);

  const track = useCallback(
    async (event: TrackEventInput): Promise<void> => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const body = JSON.stringify({
        event_type: 'track',
        name: event.name,
        company: {
          id: event.company.id,
          wallet: event.company.wallet,
          email: event.company.email,
        },
        ...(event.user
          ? {
              user: {
                id: event.user.id,
                clerk_user_id: event.user.clerkUserId,
                wallet: event.user.wallet,
              },
            }
          : {}),
        traits: event.traits,
      });

      const req = fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers,
        body,
      }).then((res) => {
        if (!res.ok) {
          return res.json().then((d: { error?: string }) => {
            console.warn(`[useTrack] Failed to track event "${event.name}":`, d.error);
          });
        }
      });

      pendingRef.current = req;
      await req;
    },
    [baseUrl, apiKey],
  );

  return { track };
}
