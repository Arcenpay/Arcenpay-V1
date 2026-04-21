// ============================================================
//  Dashboard — Ops: Billing Dunning Enforcement
//  GET  /api/ops/billing/dunning — preview enforceable subscriptions
//  POST /api/ops/billing/dunning — execute one dunning sweep
//
//  Access: OWNER or ADMIN role only. Every execution is audit-logged.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { writeAuditEvent } from "@/lib/audit";
import { runBillingDunningSweep } from "@/lib/billing-dunning";

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session) return null;
  const team = await resolveTeamContext(session);
  if (!team) return null;
  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") return null;
  return { session, team };
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const candidates = await db.subscriptionState.findMany({
    where: {
      teamId: auth.team.teamId,
      status: "PAST_DUE",
      graceEndsAt: { lte: new Date() },
    },
    orderBy: { graceEndsAt: "asc" },
    take: parsed.data.limit,
    select: {
      id: true,
      companyId: true,
      walletAddress: true,
      catalogPlanId: true,
      pastDueAt: true,
      graceEndsAt: true,
      lastSourceTxHash: true,
    },
  });

  return NextResponse.json({
    count: candidates.length,
    candidates,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sweep = await runBillingDunningSweep({
    teamId: auth.team.teamId,
    limit: 100,
  });

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing.dunning_sweep",
    resourceType: "SubscriptionState",
    metadata: sweep,
  });

  return NextResponse.json({
    ok: true,
    ...sweep,
  });
}
