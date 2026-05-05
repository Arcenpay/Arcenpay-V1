/**
 * Usage event aggregator.
 *
 * Counts ArcenEvent rows for a company within a billing period window.
 * Used by the flag engine's "usage" condition type.
 */

import { db } from "@/lib/db";

type Period = "daily" | "weekly" | "monthly";

function getPeriodWindow(period: Period): { gte: Date } {
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
    case "monthly":
    default: {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { gte: start };
    }
  }
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

  const window = getPeriodWindow(period as Period);

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
