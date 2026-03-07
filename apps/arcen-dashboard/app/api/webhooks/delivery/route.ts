import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { toPrismaNullableJson } from "@/lib/prisma-json";

const FACILITATOR_SECRET = process.env.FACILITATOR_SECRET;

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

function isAuthorized(request: NextRequest): boolean {
  if (!FACILITATOR_SECRET) return true;
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  return token === FACILITATOR_SECRET;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = deliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
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

  return NextResponse.json({ ok: true, delivery: row });
}
