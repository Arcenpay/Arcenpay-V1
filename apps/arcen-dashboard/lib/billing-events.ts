import { db } from "@/lib/db";
import { allocateInvoiceNumber, toSix } from "@/lib/invoices";
import { toPrismaJson } from "@/lib/prisma-json";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { sendInvoiceEmail } from "@/lib/email";
import { deliverWebhook } from "@/lib/deliver-webhook";

export type BillingEventType =
  | "SUBSCRIPTION_MINTED"
  | "SUBSCRIPTION_RENEWED"
  | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_FAILED"
  | "CREDIT_ISSUED";

export interface PersistBillingEventInput {
  teamId: string;
  eventType: BillingEventType;
  eventName?: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  source?: string;
  occurredAt?: Date;
  triggerInvoice?: boolean;
}

export interface BillingRecipientLookupInput {
  teamId: string;
  explicitEmail?: string | null;
  accessTokenUserId?: string | null;
  accessTokenCompanyId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  walletAddress?: string | null;
}

const CANONICAL_EVENT_NAMES: Record<BillingEventType, string> = {
  SUBSCRIPTION_MINTED: "subscription.minted",
  SUBSCRIPTION_RENEWED: "subscription.renewed",
  SUBSCRIPTION_CANCELLED: "subscription.cancelled",
  PAYMENT_FAILED: "invoice.delivery_failed",
  CREDIT_ISSUED: "invoice.issued",
};

export function resolveCanonicalBillingEventName(
  eventType: BillingEventType,
  eventName?: string,
): string {
  return eventName || CANONICAL_EVENT_NAMES[eventType];
}

export async function resolveBillingRecipientEmail(
  input: BillingRecipientLookupInput,
): Promise<string | null> {
  if (input.explicitEmail?.trim()) {
    return input.explicitEmail.trim();
  }

  const userIds = Array.from(
    new Set(
      [input.accessTokenUserId, input.userId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (userIds.length > 0) {
    const user = await db.arcenUser.findFirst({
      where: {
        teamId: input.teamId,
        id: { in: userIds },
        email: { not: null },
      },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    });
    if (user?.email) return user.email;
  }

  const companyIds = Array.from(
    new Set(
      [input.accessTokenCompanyId, input.companyId]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (companyIds.length > 0) {
    const company = await db.arcenCompany.findFirst({
      where: {
        teamId: input.teamId,
        id: { in: companyIds },
        email: { not: null },
      },
      select: { email: true },
      orderBy: { createdAt: "asc" },
    });
    if (company?.email) return company.email;
  }

  if (input.walletAddress?.trim()) {
    const record = await db.subscriberEmail.findUnique({
      where: { walletAddress: input.walletAddress.toLowerCase() },
      select: { email: true },
    });
    if (record?.email) return record.email;
  }

  return null;
}

export interface CreateChargeInvoiceInput {
  teamId: string;
  amount: number;
  description: string;
  customerEmail?: string | null;
  customerWallet?: string | null;
  planId?: string | null;
  issuedAt?: Date;
  metadata?: Record<string, unknown>;
}

export async function createIssuedChargeInvoice(input: CreateChargeInvoiceInput) {
  const team = await db.team.findUnique({
    where: { id: input.teamId },
    select: { slug: true, invoicePrefix: true, environmentMode: true },
  });

  if (!team) {
    throw new Error("Team not found");
  }

  const prefix = team.invoicePrefix || `INV-${team.slug.toUpperCase()}`;
  const number = await allocateInvoiceNumber(input.teamId, prefix);

  const invoice = await db.invoice.create({
    data: {
      teamId: input.teamId,
      environmentMode: team.environmentMode,
      status: "ISSUED",
      number,
      currency: "USDC",
      customerEmail: input.customerEmail ?? null,
      customerWallet: input.customerWallet?.toLowerCase() ?? null,
      subtotal: toSix(input.amount),
      taxTotal: toSix(0),
      total: toSix(input.amount),
      issuedAt: input.issuedAt ?? new Date(),
      planId: input.planId ?? undefined,
      metadata: toPrismaJson(input.metadata ?? {}),
      lineItems: {
        create: {
          description: input.description,
          quantity: 1,
          unitAmount: toSix(input.amount),
          taxRate: "0.0000",
          lineSubtotal: toSix(input.amount),
          lineTax: toSix(0),
          lineTotal: toSix(input.amount),
        },
      },
      ...(input.customerEmail
        ? {
            deliveries: {
              create: {
                provider: "resend",
                method: "email",
                status: "PENDING",
              },
            },
          }
        : {}),
    },
    include: { deliveries: true },
  });

  const { downloadUrl } = await ensureInvoicePdfForTeam(input.teamId, invoice.id);

  deliverWebhook(input.teamId, "invoice.issued", {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerEmail: invoice.customerEmail,
    customerWallet: invoice.customerWallet,
    total: String(invoice.total),
    currency: invoice.currency,
    status: invoice.status,
    planId: invoice.planId,
  }).catch(() => {});

  const pendingDelivery = invoice.deliveries[0];
  if (pendingDelivery && invoice.customerEmail) {
    try {
      await sendInvoiceEmail({
        to: invoice.customerEmail,
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
    } catch (error: any) {
      await db.invoiceDelivery.update({
        where: { id: pendingDelivery.id },
        data: {
          status: "FAILED",
          attempts: 1,
          errorMessage: error?.message || "send failed",
        },
      });

      deliverWebhook(input.teamId, "invoice.delivery_failed", {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerEmail: invoice.customerEmail,
        customerWallet: invoice.customerWallet,
        error: error?.message || "send failed",
      }).catch(() => {});
    }
  }

  return { invoice, downloadUrl };
}

export async function ingestBillingEvent(input: PersistBillingEventInput) {
  const canonicalEventName = resolveCanonicalBillingEventName(
    input.eventType,
    input.eventName,
  );

  const existing = await db.billingEvent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return {
      event: existing,
      invoiceId: null,
      deduped: true,
      skipped: false,
      reason: null,
    };
  }

  const event = await db.billingEvent.create({
    data: {
      teamId: input.teamId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      payload: toPrismaJson({
        ...input.payload,
        _event: {
          name: canonicalEventName,
          schemaVersion: "dashboard.v1",
          occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        },
      }),
      source: input.source ?? "dashboard",
      processed: false,
    },
  });

  let invoiceId: string | null = null;
  let skipped = false;
  let reason: string | null = null;

  if (input.triggerInvoice) {
    const amount = Number(input.payload.amount ?? 0);
    if (amount <= 0) {
      skipped = true;
      reason = "zero_amount";
    } else {
      const invoice = await createIssuedChargeInvoice({
        teamId: input.teamId,
        amount,
        description: String(input.payload.description || canonicalEventName),
        customerEmail:
          typeof input.payload.email === "string" ? input.payload.email : null,
        customerWallet:
          typeof input.payload.customerWallet === "string"
            ? input.payload.customerWallet
            : typeof input.payload.subscriber === "string"
              ? input.payload.subscriber
              : null,
        planId:
          typeof input.payload.planId === "string" ? input.payload.planId : null,
        issuedAt: input.occurredAt,
        metadata: {
          billingEventId: event.id,
          billingEventType: input.eventType,
          canonicalEventName,
          ...input.payload,
        },
      });
      invoiceId = invoice.invoice.id;
    }
  }

  await db.billingEvent.update({
    where: { id: event.id },
    data: { processed: true, processedAt: new Date() },
  });

  return {
    event,
    invoiceId,
    deduped: false,
    skipped,
    reason,
  };
}
