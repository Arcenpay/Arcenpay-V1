import { db } from "@/lib/db";
import { allocateInvoiceNumber, toSix } from "@/lib/invoices";
import { toPrismaJson } from "@/lib/prisma-json";
import { ensureInvoicePdfForTeam } from "@/lib/invoice-documents";
import { sendInvoiceEmail } from "@/lib/email";
import { deliverWebhook } from "@/lib/deliver-webhook";
import {
  recordFailedPayment,
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "@/lib/billing-ledger";

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
  PAYMENT_FAILED: "subscription.renewal_failed",
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

export async function createIssuedChargeInvoice(
  input: CreateChargeInvoiceInput,
) {
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

  const { downloadUrl } = await ensureInvoicePdfForTeam(
    input.teamId,
    invoice.id,
  );

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

async function processStoredBillingEvent(
  event: {
    id: string;
    teamId: string;
    eventType: BillingEventType;
    idempotencyKey: string;
    payload: unknown;
  },
  options: {
    triggerInvoice: boolean;
    canonicalEventName: string;
    occurredAt?: Date;
  },
) {
  const payload =
    event.payload &&
    typeof event.payload === "object" &&
    !Array.isArray(event.payload)
      ? (event.payload as Record<string, unknown>)
      : {};

  const occurredAtFromPayload =
    payload._event &&
    typeof payload._event === "object" &&
    !Array.isArray(payload._event) &&
    typeof (payload._event as Record<string, unknown>).occurredAt === "string"
      ? new Date(String((payload._event as Record<string, unknown>).occurredAt))
      : undefined;

  let invoiceId: string | null = null;
  let skipped = false;
  let reason: string | null = null;

  if (options.triggerInvoice) {
    const amount = Number(payload.amount ?? 0);
    if (amount <= 0) {
      skipped = true;
      reason = "zero_amount";
    } else {
      const invoice = await createIssuedChargeInvoice({
        teamId: event.teamId,
        amount,
        description: String(payload.description || options.canonicalEventName),
        customerEmail: typeof payload.email === "string" ? payload.email : null,
        customerWallet:
          typeof payload.customerWallet === "string"
            ? payload.customerWallet
            : typeof payload.subscriber === "string"
              ? payload.subscriber
              : null,
        planId: typeof payload.planId === "string" ? payload.planId : null,
        issuedAt: options.occurredAt ?? occurredAtFromPayload,
        metadata: {
          billingEventId: event.id,
          billingEventType: event.eventType,
          canonicalEventName: options.canonicalEventName,
          ...payload,
        },
      });
      invoiceId = invoice.invoice.id;
    }
  }

  const customerWallet =
    typeof payload.customerWallet === "string"
      ? payload.customerWallet
      : typeof payload.subscriber === "string"
        ? payload.subscriber
        : null;
  const companyId =
    typeof payload.companyId === "string" ? payload.companyId : null;
  const catalogPlanId =
    typeof payload.planId === "string" ? payload.planId : null;
  const onChainPlanId =
    typeof payload.onChainPlanId === "string" ? payload.onChainPlanId : null;
  const onChainTokenId =
    typeof payload.tokenId === "string" ? payload.tokenId : null;
  const amount = Number(payload.amount ?? 0);
  const occurredAt = options.occurredAt ?? occurredAtFromPayload ?? new Date();

  if (
    event.eventType === "SUBSCRIPTION_RENEWED" &&
    Number.isFinite(amount) &&
    amount > 0
  ) {
    const subscriptionState = await upsertSubscriptionLedgerState({
      teamId: event.teamId,
      companyId,
      walletAddress: customerWallet,
      status: "ACTIVE",
      catalogPlanId,
      onChainPlanId,
      onChainTokenId,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: options.canonicalEventName,
      lastEventAt: occurredAt,
      lastSourceTxHash: typeof payload.txHash === "string" ? payload.txHash : null,
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
      },
    });

    await recordSuccessfulPayment({
      idempotencyKey: `payment:${event.idempotencyKey}`,
      teamId: event.teamId,
      companyId,
      walletAddress: customerWallet,
      invoiceId,
      subscriptionStateId: subscriptionState?.id,
      kind: "SUBSCRIPTION_RENEWAL",
      amount,
      currency: "USDC",
      payerWallet: customerWallet,
      txHash: typeof payload.txHash === "string" ? payload.txHash : null,
      occurredAt,
      settledAt: occurredAt,
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
        canonicalEventName: options.canonicalEventName,
        ...payload,
      },
    });
  }

  if (event.eventType === "PAYMENT_FAILED") {
    const subscriptionState = await upsertSubscriptionLedgerState({
      teamId: event.teamId,
      companyId,
      walletAddress: customerWallet,
      status: "PAST_DUE",
      catalogPlanId,
      onChainPlanId,
      onChainTokenId,
      pastDueAt: occurredAt,
      graceEndsAt: new Date(occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      lastEvent: options.canonicalEventName,
      lastEventAt: occurredAt,
      lastSourceTxHash: typeof payload.txHash === "string" ? payload.txHash : null,
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
      },
    });

    await recordFailedPayment({
      idempotencyKey: `payment:${event.idempotencyKey}`,
      teamId: event.teamId,
      companyId,
      walletAddress: customerWallet,
      subscriptionStateId: subscriptionState?.id,
      kind: "SUBSCRIPTION_RENEWAL",
      amount: Number.isFinite(amount) ? amount : 0,
      currency: "USDC",
      txHash: typeof payload.txHash === "string" ? payload.txHash : null,
      occurredAt,
      errorMessage:
        typeof payload.error === "string"
          ? payload.error
          : "Subscription renewal failed",
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
        canonicalEventName: options.canonicalEventName,
        ...payload,
      },
    });
  }

  await db.billingEvent.update({
    where: { id: event.id },
    data: { processed: true, processedAt: new Date() },
  });

  return {
    invoiceId,
    skipped,
    reason,
  };
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
    if (!existing.processed) {
      const replayResult = await processStoredBillingEvent(existing, {
        triggerInvoice: Boolean(input.triggerInvoice),
        canonicalEventName,
        occurredAt: input.occurredAt,
      });
      return {
        event: existing,
        invoiceId: replayResult.invoiceId,
        deduped: true,
        skipped: replayResult.skipped,
        reason: replayResult.reason,
      };
    }

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
  const processed = await processStoredBillingEvent(event, {
    triggerInvoice: Boolean(input.triggerInvoice),
    canonicalEventName,
    occurredAt: input.occurredAt,
  });

  return {
    event,
    invoiceId: processed.invoiceId,
    deduped: false,
    skipped: processed.skipped,
    reason: processed.reason,
  };
}
