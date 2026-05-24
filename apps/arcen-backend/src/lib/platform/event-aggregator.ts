/**
 * Usage event aggregator.
 *
 * Counts ArcenEvent rows for a company within a billing period window.
 * Used by the flag engine's "usage" condition type.
 */

import { db } from "../../db.js";
import { normalizeCatalogBillingPeriod } from "../catalog/catalog-entitlements.js";

type Period = "daily" | "weekly" | "monthly" | "annual" | "plan_period";

function getPeriodWindow(period: Exclude<Period, "plan_period">): { gte: Date } {
  const now = new Date();
  switch (period) {
    case "daily": {
      const start = new Date(now);
      start.setUTCHours(0, 0, 0, 0);
      return { gte: start };
    }
    case "weekly": {
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // Sunday
      start.setUTCHours(0, 0, 0, 0);
      return { gte: start };
    }
    case "annual": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { gte: start };
    }
    case "monthly":
    default: {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { gte: start };
    }
  }
}

async function getPlanPeriodWindow(
  teamId: string,
  companyId: string,
): Promise<{ gte: Date }> {
  const now = new Date();
  const company = await db.arcenCompany.findFirst({
    where: { id: companyId, teamId },
    select: {
      traits: true,
      subscriptionState: {
        select: {
          currentPeriodStart: true,
          currentPeriodEnd: true,
          metadata: true,
        },
      },
    },
  });

  const currentPeriodStart = company?.subscriptionState?.currentPeriodStart;
  if (currentPeriodStart) {
    return { gte: currentPeriodStart };
  }

  const currentPeriodEnd = company?.subscriptionState?.currentPeriodEnd;
  const billingPeriod = normalizeCatalogBillingPeriod(
    (company?.subscriptionState?.metadata as Record<string, unknown> | null)
      ?.billingPeriod ??
      (company?.traits as Record<string, unknown> | null)?.billingPeriod,
  );

  if (currentPeriodEnd) {
    const derivedStart = new Date(currentPeriodEnd);
    if (billingPeriod === "annual") {
      derivedStart.setUTCFullYear(derivedStart.getUTCFullYear() - 1);
    } else {
      derivedStart.setUTCMonth(derivedStart.getUTCMonth() - 1);
    }
    return { gte: derivedStart };
  }

  if (billingPeriod === "annual") {
    const start = new Date(now);
    start.setUTCFullYear(start.getUTCFullYear() - 1);
    return { gte: start };
  }

  return getPeriodWindow("monthly");
}

// Simple in-process usage cache (30s TTL)
const usageCache = new Map<string, { count: number; expiresAt: number }>();

export async function aggregateUsage(
  teamId: string,
  companyId: string,
  metricKey: string,
  period: string = "monthly",
): Promise<number> {
  const cacheKey = `usage:${teamId}:${companyId}:${metricKey}:${period}`;
  const cached = usageCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.count;

  const normalizedPeriod = (() => {
    switch (period) {
      case "daily":
      case "weekly":
      case "monthly":
      case "annual":
      case "plan_period":
        return period;
      default:
        return "monthly" as const;
    }
  })();
  const window =
    normalizedPeriod === "plan_period"
      ? await getPlanPeriodWindow(teamId, companyId)
      : getPeriodWindow(normalizedPeriod);

  const count = await db.arcenEvent.count({
    where: {
      teamId,
      companyId,
      eventType: "track",
      name: metricKey,
      sentAt: window,
    },
  });

  usageCache.set(cacheKey, { count, expiresAt: Date.now() + 30_000 });
  return count;
}

export function invalidateUsageCache(teamId: string, companyId: string, metricKey?: string): void {
  const prefix = metricKey
    ? `usage:${teamId}:${companyId}:${metricKey}`
    : `usage:${teamId}:${companyId}`;
  for (const key of usageCache.keys()) {
    if (key.startsWith(prefix)) usageCache.delete(key);
  }
}
