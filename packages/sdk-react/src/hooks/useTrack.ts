/**
 * useTrack — React hook for sending usage events.
 *
 * Returns a `track` function that POSTs to /api/v1/events.
 * Calls are sent immediately; provide your own batching if needed.
 *
 * @example
 * const { track } = useTrack();
 * await track('scan', { source: 'dashboard' });
 */

import { useCallback, useRef } from 'react';
import type { ArcenCompanyKeys, ArcenUserKeys } from '@arcenpay/sdk';
import { useArcenSession } from '../providers/MEAPProvider';
import { resolveDashboardBaseUrl } from '../lib/api';

export interface TrackOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface TrackEventInput {
  name: string;
  company?: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface UseTrackResult {
  track: (event: string | TrackEventInput, traits?: Record<string, unknown>) => Promise<void>;
}

export function useTrack(options: TrackOptions = {}): UseTrackResult {
  const { apiKey } = options;
  const session = useArcenSession();
  const baseUrl = resolveDashboardBaseUrl(options.baseUrl);

  const pendingRef = useRef<Promise<void> | null>(null);

  const track = useCallback(
    async (
      event: string | TrackEventInput,
      traits?: Record<string, unknown>,
    ): Promise<void> => {
      const normalized: TrackEventInput =
        typeof event === 'string'
          ? { name: event, traits }
          : event;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
      } else if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      } else if (!normalized.company) {
        throw new Error('track() requires a session token or explicit company keys');
      }

      const body = JSON.stringify({
        event_type: 'track',
        name: normalized.name,
        ...(normalized.company
          ? {
              company: {
                id: normalized.company.id,
                wallet: normalized.company.wallet,
                email: normalized.company.email,
              },
            }
          : {}),
        ...(normalized.user
          ? {
              user: {
                id: normalized.user.id,
                clerk_user_id: normalized.user.clerkUserId,
                wallet: normalized.user.wallet,
              },
            }
          : {}),
        traits: normalized.traits,
        ...(normalized.idempotencyKey
          ? { idempotencyKey: normalized.idempotencyKey }
          : {}),
      });

      const req = fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers,
        body,
      }).then((res) => {
        if (!res.ok) {
          return res.json().then((d: { error?: string }) => {
            console.warn(
              `[useTrack] Failed to track event "${normalized.name}":`,
              d.error,
            );
          });
        }
      });

      pendingRef.current = req;
      await req;
    },
    [baseUrl, apiKey, session.token],
  );

  return { track };
}
