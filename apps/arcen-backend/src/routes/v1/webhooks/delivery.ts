import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const deliverySchema = z.object({
  teamId: z.string().min(1),
  deliveryId: z.string().min(1),
  event: z.string().min(1),
  url: z.string().url(),
  statusCode: z.number().int().nullable().optional(),
  attemptNumber: z.number().int().positive(),
  deliveredAt: z.coerce.date(),
  success: z.boolean(),
  error: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export async function recordWebhookDelivery(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const d = parsed.data;
  const existing = await db.webhookDelivery.findUnique({
    where: { deliveryId: d.deliveryId },
  });
  const row = await db.webhookDelivery.upsert({
    where: { deliveryId: d.deliveryId },
    update: {
      statusCode: d.statusCode ?? null,
      attemptNumber: d.attemptNumber,
      deliveredAt: d.deliveredAt,
      success: d.success,
      error: d.error,
      payload: toPrismaNullableJson(d.payload),
    },
    create: {
      teamId: d.teamId,
      deliveryId: d.deliveryId,
      event: d.event,
      url: d.url,
      statusCode: d.statusCode ?? null,
      attemptNumber: d.attemptNumber,
      deliveredAt: d.deliveredAt,
      success: d.success,
      error: d.error,
      payload: toPrismaNullableJson(d.payload),
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: d.teamId,
    action: existing ? "webhook.delivery.update" : "webhook.delivery.create",
    resourceType: "WebhookDelivery",
    resourceId: row.id,
    beforeData: existing
      ? {
          id: existing.id,
          statusCode: existing.statusCode,
          attemptNumber: existing.attemptNumber,
          success: existing.success,
          error: existing.error,
        }
      : undefined,
    afterData: {
      id: row.id,
      deliveryId: row.deliveryId,
      statusCode: row.statusCode,
      attemptNumber: row.attemptNumber,
      success: row.success,
      error: row.error,
    },
  });

  return c.json({ ok: true, delivery: row });
}
