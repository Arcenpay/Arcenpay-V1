import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allocateInvoiceNumber, toSix } from "@/lib/invoices";
import { toPrismaJson } from "@/lib/prisma-json";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { sendInvoiceEmail } from "@/lib/email";
import { FACILITATOR_SECRET } from "@/lib/config";

const eventSchema = z.object({
  teamId: z.string().min(1),
  eventType: z.enum([
    "SUBSCRIPTION_MINTED",
    "SUBSCRIPTION_RENEWED",
    "SUBSCRIPTION_CANCELLED",
    "PAYMENT_FAILED",
    "CREDIT_ISSUED",
  ]),
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

function isAuthorized(request: NextRequest): boolean {
  if (!FACILITATOR_SECRET) return true;
  const token = request.headers
    .get("authorization")
    ?.replace("Bearer ", "")
    .trim();
  return token === FACILITATOR_SECRET;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
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
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = eventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;

  // Idempotency: return the existing event if already processed
  const existing = await db.billingEvent.findUnique({
    where: { idempotencyKey: data.idempotencyKey },
  });
  if (existing) {
    return NextResponse.json({ ok: true, event: existing, deduped: true });
  }

  const event = await db.billingEvent.create({
    data: {
      teamId: data.teamId,
      eventType: data.eventType,
      idempotencyKey: data.idempotencyKey,
      payload: toPrismaJson(data.payload),
      source: data.source,
      processed: false,
    },
  });

  let invoiceId: string | null = null;

  if (data.triggerInvoice) {
    const team = await db.team.findUnique({
      where: { id: data.teamId },
      select: { slug: true, invoicePrefix: true, environmentMode: true },
    });

    const amount = Number(data.payload.amount || 0);
    const email =
      typeof data.payload.email === "string" ? data.payload.email : null;

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (amount <= 0 || !email) {
      // triggerInvoice requested but payload is missing required fields — skip
      // silently and still mark processed so facilitator doesn't retry endlessly.
      await db.billingEvent.update({
        where: { id: event.id },
        data: { processed: true, processedAt: new Date() },
      });
      return NextResponse.json({
        ok: true,
        eventId: event.id,
        invoiceId: null,
        skipped: true,
        reason: !email ? "missing_email" : "zero_amount",
      });
    }

    try {
      const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
      const number = await allocateInvoiceNumber(data.teamId, prefix);

      const invoice = await db.invoice.create({
        data: {
          teamId: data.teamId,
          environmentMode: team.environmentMode,
          status: "ISSUED",
          number,
          currency: "USDC",
          customerEmail: email,
          subtotal: toSix(amount),
          taxTotal: toSix(0),
          total: toSix(amount),
          issuedAt: new Date(),
          lineItems: {
            create: {
              description: String(data.payload.description || data.eventType),
              quantity: 1,
              unitAmount: toSix(amount),
              taxRate: "0.0000",
              lineSubtotal: toSix(amount),
              lineTax: toSix(0),
              lineTotal: toSix(amount),
            },
          },
          deliveries: {
            create: {
              provider: "resend",
              method: "email",
              status: "PENDING",
            },
          },
        },
        include: { deliveries: true },
      });

      invoiceId = invoice.id;

      const { downloadUrl } = await ensureInvoicePdfForTeam(
        data.teamId,
        invoice.id,
      );

      // Dispatch invoice email and update delivery record
      const pendingDelivery = invoice.deliveries[0];
      if (pendingDelivery) {
        try {
          await sendInvoiceEmail({
            to: email,
            invoiceNumber: invoice.number || invoice.id,
            total: String(invoice.total),
            currency: invoice.currency,
            dueDate: invoice.dueAt ? invoice.dueAt.toISOString() : undefined,
            downloadUrl,
          });
          await db.invoiceDelivery.update({
            where: { id: pendingDelivery.id },
            data: { status: "SENT", sentAt: new Date(), attempts: 1 },
          });
        } catch (emailErr: any) {
          await db.invoiceDelivery.update({
            where: { id: pendingDelivery.id },
            data: {
              status: "FAILED",
              attempts: 1,
              errorMessage: emailErr?.message || "send failed",
            },
          });
          // Email failure is non-fatal — invoice was created, provider can resend manually
        }
      }
    } catch (err: any) {
      // Invoice creation failed — leave event as processed: false so it can be retried
      return NextResponse.json(
        { error: "Invoice creation failed", detail: err?.message },
        { status: 500 },
      );
    }
  }

  await db.billingEvent.update({
    where: { id: event.id },
    data: { processed: true, processedAt: new Date() },
  });

  return NextResponse.json({ ok: true, eventId: event.id, invoiceId });
}
