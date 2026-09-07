"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect } from "react";

type TierLimits = {
  maxWorkspaces: number;
  maxPlans: number;
  maxSubscribers: number;
  maxTeamMembers: number;
  maxFeatureFlags: number;
  maxChains: number;
  maxDevelopmentEnvironments: number;
  maxProductionEnvironments: number;
  maxAddOns: number;
  maxCreditTypes: number;
  maxPaymentLinks: number;
  maxApiKeys: number;
  maxWebhooks: number;
  maxCoupons: number;
  maxCheckoutSessionsPerMonth: number;
  platformFeeBps: number;
  gasDailyBudgetUsd: number;
};

type TierFeatures = {
  analytics: boolean;
  webhooks: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
  managedPlanEditing: boolean;
  crossChainBilling: boolean;
  whiteGloveOnboarding: boolean;
  agentPayments: boolean;
  zkSettlement: boolean;
  crossChainMirroring: boolean;
  tableland: boolean;
  litProtocol: boolean;
};

export type TierInfo = {
  tier: string;
  limits: TierLimits;
  pricing: { priceUsdc: number; interval: string };
  features: TierFeatures;
};

export type TeamTier = {
  tier: string;
  expiresAt: string | null;
  limits: TierLimits;
  features: TierFeatures;
  usage: {
    plans: number;
    members: number;
  };
} | null;

const tierCache = new Map<string, { data: TeamTier; ts: number }>();
const CACHE_TTL = 60_000; // 1 minute

export function useTeamTier(): {
  currentTier: TeamTier;
  allTiers: TierInfo[];
  loading: boolean;
} {
  const [currentTier, setCurrentTier] = useState<TeamTier>(null);
  const [allTiers, setAllTiers] = useState<TierInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = tierCache.get("tier");
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      setCurrentTier(cached.data);
      setLoading(false);
      return;
    }

    let cancelled = false;

    apiFetch("/api/platform/tier")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCurrentTier(data.current ?? null);
        setAllTiers(data.allTiers ?? []);
        if (data.current) {
          tierCache.set("tier", {
            data: data.current,
            ts: Date.now(),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { currentTier, allTiers, loading };
}
