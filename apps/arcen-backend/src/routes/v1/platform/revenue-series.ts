import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { isErrorResponse, requirePermission } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  granularity: z.enum(["monthly", "daily"]).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

/* ── Monthly helpers ──────────────────────────────────── */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/* ── Daily helpers ────────────────────────────────────── */
function dayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function dayStartUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function getRevenueSeries(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const granularity = parsed.data.granularity ?? "monthly";
  const months = parsed.data.months ?? 12;
  const days = parsed.data.days ?? 30;

  // Broader plan lookup: all plans in the team (cross-environment safety net)
  const allTeamPlanIds = (
    await db.catalogPlan.findMany({
      where: { teamId: auth.team.teamId },
      select: { id: true },
    })
  ).map((plan) => plan.id);

  const now = new Date();

  let oldestDate: Date;
  let keyFn: (d: Date) => string;
  let labelFn: (d: Date) => string;
  let startFn: (d: Date) => Date;
  let length: number;
  let incrementFn: (d: Date, index: number) => Date;

  if (granularity === "daily") {
    const currentDay = dayStartUtc(now);
    oldestDate = new Date(
      Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth(), currentDay.getUTCDate() - (days - 1)),
    );
    keyFn = dayKey;
    labelFn = dayLabel;
    startFn = dayStartUtc;
    length = days;
    incrementFn = (base, index) =>
      new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + index));
  } else {
    const currentMonth = monthStartUtc(now);
    oldestDate = new Date(
      Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - (months - 1), 1),
    );
    keyFn = monthKey;
    labelFn = monthLabel;
    startFn = monthStartUtc;
    length = months;
    incrementFn = (base, index) =>
      new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + index, 1));
  }

  const invoices = await db.invoice.findMany({
    where: {
      teamId: auth.team.teamId,
      status: "PAID",
      issuedAt: { gte: oldestDate },
      OR: [
        { environmentId: activeEnvironment.id },
        { environmentId: null },
        ...(allTeamPlanIds.length > 0
          ? [{ planId: { in: allTeamPlanIds } }]
          : []),
      ],
    },
    select: {
      total: true,
      issuedAt: true,
      createdAt: true,
    },
  });

  const totalsByPeriod = new Map<string, number>();
  for (const invoice of invoices) {
    const effectiveDate = invoice.issuedAt ?? invoice.createdAt;
    const key = keyFn(startFn(effectiveDate));
    totalsByPeriod.set(key, (totalsByPeriod.get(key) ?? 0) + Number(invoice.total));
  }

  const points = Array.from({ length }, (_, index) => {
    const date = incrementFn(oldestDate, index);
    const key = keyFn(date);
    return {
      label: labelFn(date),
      revenueRaw: totalsByPeriod.has(key)
        ? String(Math.round((totalsByPeriod.get(key) ?? 0) * 1_000_000))
        : "0",
    };
  });

  return c.json({
    context: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
      chainId: activeEnvironment.chainId,
    },
    granularity,
    points,
  });
}
