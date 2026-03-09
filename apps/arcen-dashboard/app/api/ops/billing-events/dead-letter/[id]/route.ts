// ============================================================
//  Dashboard — Ops: Billing Event Single Retry
//  POST /api/ops/billing-events/dead-letter/:id — replay one event
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { writeAuditEvent } from "@/lib/audit";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "@/lib/config";

type Params = { params: Promise<{ id: string }> };

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session) return null;
  const team = await resolveTeamContext(session);
  if (!team) return null;
  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") return null;
  return { session, team };
}

/**
 * POST /api/ops/billing-events/dead-letter/:id
 * Replays a single unprocessed billing event.
 */
export async function POST(request: NextRequest, context: Params) {
  const auth = await requireAdmin(request);
  if (!auth) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await context.params;

  const event = await db.billingEvent.findFirst({
    where: { id, teamId: auth.team.teamId, processed: false },
  });

  if (!event) {
    return NextResponse.json(
      { error: "Billing event not found or already processed" },
      { status: 404 },
    );
  }

  const upstream = await fetch(`${FACILITATOR_URL}/api/billing/events`, {
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

  await writeAuditEvent({
    request,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing_events.dead_letter_replay",
    resourceType: "BillingEvent",
    resourceId: event.id,
    metadata: { eventType: event.eventType, ok: upstream.ok, status: upstream.status },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: "Facilitator rejected replay", facilitatorStatus: upstream.status },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, eventId: event.id, replayed: true });
}
