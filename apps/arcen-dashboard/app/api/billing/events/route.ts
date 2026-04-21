import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";
import { writeAuditEvent } from "@/lib/audit";
import {
  ingestBillingEvent,
  resolveCanonicalBillingEventName,
} from "@/lib/billing-events";

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

export async function GET(request: NextRequest) {
  const authError = requireFacilitatorAuth(request);
  if (authError) return authError;

  const parsed = listQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
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

  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const authError = requireFacilitatorAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;

  const canonicalEventName = resolveCanonicalBillingEventName(
    data.eventType,
    data.eventName,
  );

  const result = await ingestBillingEvent({
    teamId: data.teamId,
    eventType: data.eventType,
    eventName: canonicalEventName,
    idempotencyKey: data.idempotencyKey,
    payload: data.payload,
    source: data.source,
    occurredAt: data.occurredAt,
    triggerInvoice: data.triggerInvoice,
  });

  await writeAuditEvent({
    request,
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

  return NextResponse.json({
    ok: true,
    eventId: result.event.id,
    invoiceId: result.invoiceId,
    deduped: result.deduped,
    skipped: result.skipped,
    reason: result.reason,
  });
}
