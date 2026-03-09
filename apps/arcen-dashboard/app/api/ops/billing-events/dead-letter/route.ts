// ============================================================
//  Dashboard — Ops: Billing Events Dead-Letter Queue
//  GET  /api/ops/billing-events/dead-letter — list unprocessed events
//  POST /api/ops/billing-events/dead-letter — retry all unprocessed
//
//  Access: OWNER or ADMIN role only. Every action is audit-logged.
//  GA Phase 7 — operator admin surface for billing event recovery.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { writeAuditEvent } from "@/lib/audit";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session) return null;
  const team = await resolveTeamContext(session);
  if (!team) return null;
  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") return null;
  return { session, team };
}

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  eventType: z
    .enum([
      "SUBSCRIPTION_MINTED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_CANCELLED",
      "PAYMENT_FAILED",
      "CREDIT_ISSUED",
    ])
    .optional(),
});

/**
 * GET /api/ops/billing-events/dead-letter
 * Lists unprocessed billing events (those that failed all retries).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const events = await db.billingEvent.findMany({
    where: {
      teamId: auth.team.teamId,
      processed: false,
      ...(parsed.data.eventType && { eventType: parsed.data.eventType }),
    },
    orderBy: { createdAt: "asc" },
    take: parsed.data.limit,
    select: {
      id: true,
      eventType: true,
      idempotencyKey: true,
      source: true,
      createdAt: true,
      payload: true,
    },
  });

  return NextResponse.json({ count: events.length, events });
}

/**
 * POST /api/ops/billing-events/dead-letter
 * Replays all unprocessed billing events by forwarding them to the
 * facilitator billing bridge endpoint, which will re-enqueue them.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const events = await db.billingEvent.findMany({
    where: { teamId: auth.team.teamId, processed: false },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (events.length === 0) {
    return NextResponse.json({ ok: true, replayed: 0, message: "No unprocessed events." });
  }

  const results = await Promise.allSettled(
    events.map(async (event) => {
      const res = await fetch(`${FACILITATOR_URL}/api/billing/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(FACILITATOR_SECRET ? { Authorization: `Bearer ${FACILITATOR_SECRET}` } : {}),
        },
        body: JSON.stringify({
          teamId: event.teamId,
          eventType: event.eventType,
          idempotencyKey: `retry:${event.idempotencyKey}:${Date.now()}`,
          eventName:
            typeof (event.payload as any)?._event?.name === "string"
              ? (event.payload as any)._event.name
              : undefined,
          schemaVersion:
            typeof (event.payload as any)?._event?.schemaVersion === "string"
              ? (event.payload as any)._event.schemaVersion
              : undefined,
          occurredAt:
            typeof (event.payload as any)?._event?.occurredAt === "string"
              ? (event.payload as any)._event.occurredAt
              : undefined,
          payload: event.payload,
          source: "ops-replay",
          triggerInvoice: false,
        }),
      });
      return { id: event.id, ok: res.ok, status: res.status };
    }),
  );

  const succeeded = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  const failed = results.length - succeeded;

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing_events.dead_letter_replay_all",
    resourceType: "BillingEvent",
    metadata: { total: events.length, succeeded, failed },
  });

  return NextResponse.json({
    ok: true,
    replayed: succeeded,
    failed,
    total: events.length,
  });
}
