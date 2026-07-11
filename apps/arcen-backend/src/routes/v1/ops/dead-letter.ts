import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { ingestBillingEvent } from "../../../lib/billing/billing-events.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";

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

function shouldTriggerInvoice(eventType: string): boolean {
  return (
    eventType === "SUBSCRIPTION_MINTED" ||
    eventType === "SUBSCRIPTION_RENEWED" ||
    eventType === "CREDIT_ISSUED"
  );
}

export async function getDeadLetterEvents(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = listQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
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

  return c.json({ count: events.length, events });
}

export async function replayDeadLetterEvents(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const events = await db.billingEvent.findMany({
    where: { teamId: auth.team.teamId, processed: false },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  if (events.length === 0) {
    return c.json({
      ok: true,
      replayed: 0,
      message: "No unprocessed events.",
    });
  }

  const results = await Promise.allSettled(
    events.map(async (event) => {
      const result = await ingestBillingEvent({
        teamId: event.teamId,
        eventType: event.eventType as any,
        idempotencyKey: event.idempotencyKey,
        payload: event.payload as Record<string, unknown>,
        source: "ops-replay",
        triggerInvoice: shouldTriggerInvoice(event.eventType),
      });
      return { id: event.id, ok: !result.skipped, status: result.deduped ? 200 : 201 };
    }),
  );

  const succeeded = results.filter(
    (r) => r.status === "fulfilled" && r.value.ok,
  ).length;
  const failed = results.length - succeeded;

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "ops.billing_events.dead_letter_replay_all",
    resourceType: "BillingEvent",
    metadata: { total: events.length, succeeded, failed },
  });

  return c.json({
    ok: true,
    replayed: succeeded,
    failed,
    total: events.length,
  });
}
