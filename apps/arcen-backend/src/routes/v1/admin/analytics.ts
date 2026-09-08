import { Hono } from "hono";
import { z } from "zod";
import { requireAdminAuth } from "../../../middleware/auth.js";
import { db } from "../../../db.js";
import { DUNE_API_KEY } from "../../../config.js";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  ts: number;
}
let duneCache: CacheEntry | null = null;

export const adminAnalyticsRouter = new Hono()
  // ── Weekly Trends (chart data) ─────────────────────────────────
  .get("/trends", requireAdminAuth(), async (c) => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const dateStr = thirtyDaysAgo.toISOString();

    // Daily team creation counts for last 30 days
    const teamsPerDay = await db.$queryRawUnsafe<{ day: string; count: bigint }[]>(
      `SELECT DATE("createdAt") as day, COUNT(*)::int8 as count FROM "Team" WHERE "createdAt" >= $1::timestamp GROUP BY DATE("createdAt") ORDER BY day ASC`,
      dateStr
    );

    // Daily activation counts for last 30 days (when isPlatformActivated was last updated)
    const activationsPerDay = await db.$queryRawUnsafe<{ day: string; count: bigint }[]>(
      `SELECT DATE("updatedAt") as day, COUNT(*)::int8 as count FROM "Team" WHERE "isPlatformActivated" = true AND "updatedAt" >= $1::timestamp GROUP BY DATE("updatedAt") ORDER BY day ASC`,
      dateStr
    );

    // Daily redemption counts for last 30 days
    const redemptionsPerDay = await db.$queryRawUnsafe<{ day: string; count: bigint }[]>(
      `SELECT DATE("createdAt") as day, COUNT(*)::int8 as count FROM "PlatformActivationRedemption" WHERE "createdAt" >= $1::timestamp GROUP BY DATE("createdAt") ORDER BY day ASC`,
      dateStr
    );

    // Current period stats
    const [teamsLast7, activationsLast7, redemptionsLast7, teamsYesterday, activationsYesterday] = await Promise.all([
      db.team.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.team.count({ where: { isPlatformActivated: true, updatedAt: { gte: sevenDaysAgo } } }),
      db.platformActivationRedemption.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      db.team.count({ where: { createdAt: { gte: yesterday } } }),
      db.team.count({ where: { isPlatformActivated: true, updatedAt: { gte: yesterday } } }),
    ]);

    const buildDayMap = (rows: { day: string; count: bigint }[]) => {
      const map = new Map<string, number>();
      for (const r of rows) map.set(r.day, Number(r.count));
      return map;
    };

    const teamMap = buildDayMap(teamsPerDay);
    const activationMap = buildDayMap(activationsPerDay);
    const redemptionMap = buildDayMap(redemptionsPerDay);

    const trendData: { date: string; teams: number; activations: number; redemptions: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split("T")[0];
      trendData.push({
        date: key,
        teams: teamMap.get(key) || 0,
        activations: activationMap.get(key) || 0,
        redemptions: redemptionMap.get(key) || 0,
      });
    }

    return c.json({
      ok: true,
      data: { trendData, totals: { teamsLast7, activationsLast7, redemptionsLast7, teamsYesterday, activationsYesterday } },
    });
  })
  // ── MRR / Revenue Estimate ──────────────────────────────────────
  .get("/revenue", requireAdminAuth(), async (c) => {
    const tierCounts = await db.team.groupBy({
      by: ["platformTier"],
      _count: { id: true },
    });
    const tierPrices: Record<string, number> = { FREE: 0, PLUS: 19, PRO: 99 };
    let mrr = 0;
    const tierBreakdown = tierCounts.map((t) => {
      const price = tierPrices[t.platformTier] || 0;
      const rev = price * t._count.id;
      mrr += rev;
      return { tier: t.platformTier, count: t._count.id, price, monthlyRevenue: rev };
    });
    return c.json({ ok: true, data: { mrr, tierBreakdown } });
  })
  // ── Dune API Proxy ───────────────────────────────────────────────
  .get("/dune/:queryId", requireAdminAuth(), async (c) => {
    const queryId = c.req.param("queryId");
    if (!DUNE_API_KEY) {
      return c.json({ ok: false, error: "DUNE_API_KEY not configured", duneConfigured: false });
    }
    if (duneCache && Date.now() - duneCache.ts < 5 * 60 * 1000) {
      return c.json({ ok: true, data: duneCache.data, cached: true });
    }
    try {
      const execRes = await fetch(`https://api.dune.com/api/v1/query/${queryId}/execute`, {
        method: "POST",
        headers: { "x-dune-api-key": DUNE_API_KEY },
      });
      if (!execRes.ok) {
        const errText = await execRes.text();
        return c.json({ ok: false, error: `Dune execute error: ${execRes.status} ${errText}` }, 502 as any);
      }
      const execData = await execRes.json() as { execution_id?: string };
      const executionId = execData.execution_id ?? "";

      let attempts = 0;
      const maxAttempts = 15;
      let resultData: unknown = null;
      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        const resRes = await fetch(`https://api.dune.com/api/v1/execution/${executionId}/results`, {
          headers: { "x-dune-api-key": DUNE_API_KEY },
        });
        if (resRes.ok) {
          resultData = await resRes.json();
          break;
        }
        attempts++;
      }

      if (!resultData) {
        return c.json({ ok: false, error: "Dune query timed out after 30s polling" }, 502 as any);
      }

      duneCache = { data: resultData, ts: Date.now() };
      return c.json({ ok: true, data: resultData, cached: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: `Dune proxy error: ${msg}` }, 502 as any);
    }
  })
  // ── Dune config status ──────────────────────────────────────────
  .get("/dune-status", requireAdminAuth(), async (c) => {
    return c.json({ ok: true, data: { configured: !!DUNE_API_KEY, hasKey: DUNE_API_KEY.length > 0 } });
  });
