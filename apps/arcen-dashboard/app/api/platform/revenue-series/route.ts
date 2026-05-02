import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { isErrorResponse, requirePermission } from "@/lib/api-auth";
import { normalizeEnvironmentMode } from "@/lib/default-chain";

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

export async function GET(request: NextRequest) {
  const auth = await requirePermission("catalog:read");
  if (isErrorResponse(auth)) return auth;

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const team = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { environmentMode: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const environmentMode = normalizeEnvironmentMode(
    parsed.data.environmentMode || team.environmentMode,
  );
  const months = parsed.data.months ?? 12;

  const now = new Date();
  const currentMonth = monthStartUtc(now);
  const oldestMonth = new Date(
    Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() - (months - 1), 1),
  );

  const invoices = await db.invoice.findMany({
    where: {
      teamId: auth.team.teamId,
      environmentMode,
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

  return NextResponse.json({
    context: {
      teamId: auth.team.teamId,
      environmentMode,
    },
    points,
  });
}
