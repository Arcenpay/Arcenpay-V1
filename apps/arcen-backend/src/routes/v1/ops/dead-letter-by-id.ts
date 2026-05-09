import type { Context } from "hono";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { FACILITATOR_URL, FACILITATOR_SECRET } from "../../../config.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

function shouldTriggerInvoice(eventType: string): boolean {
  return (
    eventType === "SUBSCRIPTION_MINTED" ||
    eventType === "SUBSCRIPTION_RENEWED" ||
    eventType === "CREDIT_ISSUED"
  );
}

export async function replayDeadLetterById(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const event = await db.billingEvent.findFirst({
    where: { id, teamId: auth.team.teamId, processed: false },
  });

  if (!event) {
    return c.json({ error: "Billing event not found or already processed" }, 404 as any);
  }

  const upstream = await fetch(`${FACILITATOR_URL}/api/billing/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(FACILITATOR_SECRET
        ? { Authorization: `Bearer ${FACILITATOR_SECRET}` }
        : {}),
    },
    body: JSON.stringify({
      teamId: event.teamId,
      eventType: event.eventType,
      idempotencyKey: event.idempotencyKey,
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
      triggerInvoice: shouldTriggerInvoice(event.eventType),
    }),
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing_events.dead_letter_replay",
    resourceType: "BillingEvent",
    resourceId: event.id,
    metadata: {
      eventType: event.eventType,
      ok: upstream.ok,
      status: upstream.status,
    },
  });

  if (!upstream.ok) {
    return c.json({
        error: "Facilitator rejected replay",
        facilitatorStatus: upstream.status,
      }, 502 as any);
  }

  return c.json({ ok: true, eventId: event.id, replayed: true });
}
