"use client";

import { useCallback, useState } from "react";
import type {
  ArcenCompanyKeys,
  ArcenUserKeys,
  ConsumeEntitlementResult,
} from "@arcenpay/sdk";
import { useArcenSession } from "../providers/MEAPProvider";
import { resolveDashboardBaseUrl } from "../lib/api";

export interface ConsumeEntitlementInput {
  featureKey: string;
  company?: ArcenCompanyKeys;
  user?: ArcenUserKeys;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface UseConsumeEntitlementOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface UseConsumeEntitlementResult {
  consume: (
    input: string | ConsumeEntitlementInput,
  ) => Promise<ConsumeEntitlementResult>;
  loading: boolean;
  error: string | null;
}

export function useConsumeEntitlement(
  options: UseConsumeEntitlementOptions = {},
): UseConsumeEntitlementResult {
  const session = useArcenSession();
  const baseUrl = resolveDashboardBaseUrl(options.baseUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consume = useCallback(
    async (input: string | ConsumeEntitlementInput) => {
      const normalized =
        typeof input === "string" ? { featureKey: input } : input;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (session.token) {
        headers.Authorization = `Bearer ${session.token}`;
      } else if (options.apiKey) {
        headers.Authorization = `Bearer ${options.apiKey}`;
      } else if (!normalized.company) {
        throw new Error(
          "consume() requires a session token or explicit company keys",
        );
      }

      if (!session.token && normalized.company) {
        const companyKeyParts: string[] = [];
        if (normalized.company.id) companyKeyParts.push(`id=${normalized.company.id}`);
        if (normalized.company.wallet) companyKeyParts.push(`wallet=${normalized.company.wallet}`);
        if (normalized.company.email) companyKeyParts.push(`email=${normalized.company.email}`);
        if (companyKeyParts.length > 0) {
          headers["X-Arcen-Company-Keys"] = companyKeyParts.join(",");
        }
      }

      if (!session.token && normalized.user) {
        const userKeyParts: string[] = [];
        if (normalized.user.id) userKeyParts.push(`id=${normalized.user.id}`);
        if (normalized.user.clerkUserId) {
          userKeyParts.push(`clerk_user_id=${normalized.user.clerkUserId}`);
        }
        if (normalized.user.wallet) userKeyParts.push(`wallet=${normalized.user.wallet}`);
        if (userKeyParts.length > 0) {
          headers["X-Arcen-User-Keys"] = userKeyParts.join(",");
        }
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${baseUrl}/api/v1/usage/consume`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            featureKey: normalized.featureKey,
            traits: normalized.traits,
            ...(normalized.idempotencyKey
              ? { idempotencyKey: normalized.idempotencyKey }
              : {}),
          }),
        });

        const json = (await response.json()) as
          | ConsumeEntitlementResult
          | { error?: string };

        if (!response.ok) {
          throw new Error((json as { error?: string }).error ?? `HTTP ${response.status}`);
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
    [baseUrl, options.apiKey, session.token],
  );

  return { consume, loading, error };
}
