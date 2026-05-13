import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { isErrorResponse, requirePermission } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const querySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
});

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

  const months = parsed.data.months ?? 12;

  const now = new Date();
  const currentMonth = monthStartUtc(now);
  const oldestMonth = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - (months - 1), 1),
  );

  const invoices = await db.invoice.findMany({
    where: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      status: "PAID",
      issuedAt: { gte: oldestMonth },
    },
    select: {
      total: true,
      issuedAt: true,
      createdAt: true,
    },
  });

  const totalsByMonth = new Map<string, number>();
  for (const invoice of invoices) {
    const effectiveDate = invoice.issuedAt ?? invoice.createdAt;
    const key = monthKey(monthStartUtc(effectiveDate));
    totalsByMonth.set(key, (totalsByMonth.get(key) ?? 0) + Number(invoice.total));
  }

  const points = Array.from({ length: months }, (_, index) => {
    const date = new Date(
      Date.UTC(oldestMonth.getUTCFullYear(), oldestMonth.getUTCMonth() + index, 1),
    );
    const key = monthKey(date);
    return {
      label: monthLabel(date),
      revenueRaw: totalsByMonth.has(key)
        ? String(Math.round((totalsByMonth.get(key) ?? 0) * 1_000_000))
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
    points,
  });
}
