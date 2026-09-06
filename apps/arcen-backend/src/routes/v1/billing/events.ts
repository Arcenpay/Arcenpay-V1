import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  ingestBillingEvent,
  resolveCanonicalBillingEventName,
} from "../../../lib/billing/billing-events.js";

const eventSchema = z.object({
  teamId: z.string().min(1),
  eventType: z.enum([
    "SUBSCRIPTION_MINTED",
    "SUBSCRIPTION_RENEWED",
    "SUBSCRIPTION_CANCELLED",
    "PAYMENT_FAILED",
    "CREDIT_ISSUED",
  ]),
  eventName: z
    .enum([
      "subscription.minted",
      "subscription.renewed",
      "subscription.cancelled",
      "subscription.renewal_failed",
      "proof.generated",
      "proof.submitted",
      "proof.settled",
      "invoice.issued",
      "invoice.delivery_failed",
      "invoice.paid",
    ])
    .optional(),
  schemaVersion: z.string().min(1).optional(),
  occurredAt: z.coerce.date().optional(),
  idempotencyKey: z.string().min(1),
  payload: z.record(z.unknown()),
  source: z.string().default("facilitator"),
  triggerInvoice: z.boolean().default(false),
  // Top-level chainId supplied by the facilitator (falls back to payload.chainId
  // or schema default 84532 = EVM downstream). Used to derive `chainFamily`
  // for SubscriptionState rows created from this event.
  chainId: z.number().int().positive().optional(),
});

const listQuerySchema = z.object({
  teamId: z.string().min(1),
  processed: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  eventType: z
    .enum([
      "SUBSCRIPTION_MINTED",
      "SUBSCRIPTION_RENEWED",
      "SUBSCRIPTION_CANCELLED",
      "PAYMENT_FAILED",
      "CREDIT_ISSUED",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(c: Context) {
  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(new URL(c.req.url).searchParams),
  );
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { teamId, processed, eventType, limit } = parsed.data;

  const events = await db.billingEvent.findMany({
    where: {
      teamId,
      ...(processed !== undefined && { processed }),
      ...(eventType && { eventType }),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return c.json({ events });
}

export async function POST(c: Context) {
  const body = await c.req.json() .catch(() => ({}));
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

const data = parsed.data;

// Inject the top-level chainId into the payload (if absent) so any downstream
// consumer reading `payload.chainId` (the billing ledger) sees the correct
// chainId for chainFamily derivation. EVM: real chain id. Stellar: 9_000_000+.
const payloadWithChainId: Record<string, unknown> =
  data.chainId !== undefined &&
  typeof data.payload.chainId !== "number"
    ? { ...data.payload, chainId: data.chainId }
    : data.payload;

const canonicalEventName = resolveCanonicalBillingEventName(
  data.eventType,
  data.eventName,
);

const result = await ingestBillingEvent({
  teamId: data.teamId,
  eventType: data.eventType,
  eventName: canonicalEventName,
  idempotencyKey: data.idempotencyKey,
  payload: payloadWithChainId,
  source: data.source,
  occurredAt: data.occurredAt,
  triggerInvoice: data.triggerInvoice,
});

  await writeAuditEvent({
    headers: { get: (name: string) => c.req.header(name) },
    teamId: data.teamId,
    action: result.deduped ? "billing.event.ingest.deduped" : "billing.event.ingest",
    resourceType: "BillingEvent",
    resourceId: result.event.id,
    afterData: {
      id: result.event.id,
      eventType: result.event.eventType,
      idempotencyKey: result.event.idempotencyKey,
      source: result.event.source,
      processed: result.event.processed,
      canonicalEventName,
    },
  });

  return c.json({
    ok: true,
    eventId: result.event.id,
    invoiceId: result.invoiceId,
    deduped: result.deduped,
    skipped: result.skipped,
    reason: result.reason,
  });
}
