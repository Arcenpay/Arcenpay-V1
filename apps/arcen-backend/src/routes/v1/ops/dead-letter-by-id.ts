import type { Context } from "hono";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { ingestBillingEvent } from "../../../lib/billing/billing-events.js";
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

  const result = await ingestBillingEvent({
    teamId: event.teamId,
    eventType: event.eventType as any,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload as Record<string, unknown>,
    source: "ops-replay",
    triggerInvoice: shouldTriggerInvoice(event.eventType),
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
      ok: !result.skipped,
    },
  });

  if (result.skipped) {
    return c.json({
        error: "Event replay was skipped",
      }, 502 as any);
  }

  return c.json({ ok: true, eventId: event.id, replayed: true });
}
