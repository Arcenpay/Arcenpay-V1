import { db } from "../../db.js";
import { allocateInvoiceNumber, toSix } from "./invoices.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { ensureInvoicePdfForTeam } from "./invoice-documents.js";
import { sendInvoiceEmail } from "./email.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { findScopedSubscriberEmail } from "./subscriber-emails.js";
import {
  recordFailedPayment,
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "./billing-ledger.js";
import { projectPlatformBillingEntitlement } from "./platform-billing-customer.js";
import { grantPlanCreditsForCompany } from "./usage-credits.js";
import { deriveBillingPeriodFromInterval, normalizeWallet } from "./utils.js";
import { sendPaidInvoiceReceipt } from "./invoice-notifications.js";

/**
 * Resolves the recipient for an issued invoice. The facilitator's on-chain
 * event payloads do not carry an email, so fall back to the company record and
 * then the scoped subscriber-email registry — otherwise the invoice is created
 * with no recipient and no receipt can ever be delivered.
 */
async function resolveInvoiceCustomerEmail(input: {
  payloadEmail: string | null;
  teamId: string;
  environmentId: string | null;
  companyId: string | null;
  wallet: string | null;
}): Promise<string | null> {
  const direct = input.payloadEmail?.trim();
  if (direct) return direct;

  if (input.companyId) {
    const company = await db.arcenCompany
      .findUnique({ where: { id: input.companyId }, select: { email: true } })
      .catch(() => null);
    const email = company?.email?.trim();
    if (email) return email;
  }

  if (input.wallet) {
    const scoped = await findScopedSubscriberEmail({
      teamId: input.teamId,
      environmentId: input.environmentId,
      walletAddress: input.wallet,
    }).catch(() => null);
    const email = scoped?.email?.trim();
    if (email) return email;
  }

  return null;
}

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
  environmentId?: string | null;
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
  CREDIT_ISSUED: "credit.issued",
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
    const record = await findScopedSubscriberEmail({
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      walletAddress: input.walletAddress,
    });
    if (record?.email) return record.email;
  }

  return null;
}

export interface CreateChargeInvoiceInput {
  teamId: string;
  environmentId?: string | null;
  environmentMode?: "DEVELOPMENT" | "PRODUCTION";
  amount: number;
  description: string;
  customerEmail?: string | null;
  customerWallet?: string | null;
  customerName?: string | null;
  companyId?: string | null;
  planId?: string | null;
  issuedAt?: Date;
  metadata?: Record<string, unknown>;
  sendInvoiceEmail?: boolean;
  /**
   * On-chain transaction this invoice is for. Used to make invoice creation
   * idempotent per payment — see the guard below.
   */
  paymentTxHash?: string | null;
}

export async function createIssuedChargeInvoice(
  input: CreateChargeInvoiceInput,
) {
  // Idempotency: one on-chain payment ⇒ exactly ONE invoice.
  //
  // A subscription is projected by TWO independent paths — the synchronous
  // activation (`finalizeSubscriptionActivation`, which already dedups) and this
  // event path (the facilitator). Without this guard the event path issued a
  // SECOND invoice for a payment that was already invoiced, which also produced
  // a second receipt email. The payment itself was never duplicated (txHash is
  // unique), so this was a double-invoice bug, not a double-charge.
  const paymentTxHash = input.paymentTxHash?.trim();
  if (paymentTxHash) {
    const existingInvoiceId =
      (
        await db.payment.findUnique({
          where: { txHash: paymentTxHash },
          select: { invoiceId: true },
        })
      )?.invoiceId ??
      (
        await db.invoice.findFirst({
          where: {
            teamId: input.teamId,
            metadata: { path: ["txHash"], equals: paymentTxHash } as any,
          },
          select: { id: true },
        })
      )?.id ??
      null;

    if (existingInvoiceId) {
      const existingInvoice = await db.invoice.findUnique({
        where: { id: existingInvoiceId },
      });
      if (existingInvoice) {
        const { downloadUrl } = await ensureInvoicePdfForTeam(
          input.teamId,
          existingInvoice.id,
        );
        return { invoice: existingInvoice, downloadUrl };
      }
    }
  }

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
      environmentId: input.environmentId ?? null,
      environmentMode: input.environmentMode ?? team.environmentMode,
      status: "ISSUED",
      number,
      currency: "USDC",
      customerEmail: input.customerEmail ?? null,
      customerWallet: normalizeWallet(input.customerWallet),
      subtotal: toSix(input.amount),
      taxTotal: toSix(0),
      total: toSix(input.amount),
      amountPaid: toSix(0),
      amountCredited: toSix(0),
      amountOutstanding: toSix(input.amount),
      issuedAt: input.issuedAt ?? new Date(),
      planId: input.planId ?? undefined,
      companyId: input.companyId ?? undefined,
      metadata: toPrismaJson({
        ...(input.metadata ?? {}),
        ...(input.customerName ? { customerName: input.customerName } : {}),
        emailDeliveryStrategy:
          input.sendInvoiceEmail === true ? "invoice_email" : "receipt_only",
      }),
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
      ...(input.customerEmail && input.sendInvoiceEmail
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
  }).catch((err) => {
    console.warn(
      "[billing-events] Failed to deliver webhook for invoice payment:",
      err,
    );
  });

  const pendingDelivery = invoice.deliveries[0];
  if (input.sendInvoiceEmail && pendingDelivery && invoice.customerEmail) {
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
      }).catch((err) => {
        console.warn(
          "[billing-events] Failed to deliver webhook for invoice send error:",
          err,
        );
      });
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
  const payloadEnvironmentId =
    typeof payload.environmentId === "string" && payload.environmentId.trim()
      ? payload.environmentId.trim()
      : null;

  const resolveExpirationDate = () => {
    const rawExpiration = payload.expiration;
    if (
      typeof rawExpiration === "number" &&
      Number.isFinite(rawExpiration) &&
      rawExpiration > 0
    ) {
      return new Date(rawExpiration * 1000);
    }

    if (typeof rawExpiration === "string" && rawExpiration.trim()) {
      const asNumber = Number(rawExpiration);
      if (Number.isFinite(asNumber) && asNumber > 0) {
        return new Date(asNumber * 1000);
      }
    }

    return null;
  };

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
      const resolvedPlanId =
        typeof payload.catalogPlanId === "string" &&
        payload.catalogPlanId.trim()
          ? payload.catalogPlanId.trim()
          : typeof payload.planId === "string" && payload.planId.trim()
            ? payload.planId.trim()
            : null;
      const invoice = await createIssuedChargeInvoice({
        teamId: event.teamId,
        environmentId: payloadEnvironmentId,
        amount,
        description: String(payload.description || options.canonicalEventName),
        paymentTxHash:
          typeof payload.txHash === "string" ? payload.txHash : null,
        customerEmail: await resolveInvoiceCustomerEmail({
          payloadEmail:
            typeof payload.email === "string" ? payload.email : null,
          teamId: event.teamId,
          environmentId:
            typeof payload.environmentId === "string"
              ? payload.environmentId
              : null,
          companyId:
            typeof payload.companyId === "string" && payload.companyId.trim()
              ? payload.companyId.trim()
              : null,
          wallet:
            typeof payload.customerWallet === "string"
              ? payload.customerWallet
              : typeof payload.subscriber === "string"
                ? payload.subscriber
                : null,
        }),
        customerName:
          typeof payload.customerName === "string"
            ? payload.customerName
            : null,
        customerWallet:
          typeof payload.customerWallet === "string"
            ? payload.customerWallet
            : typeof payload.subscriber === "string"
              ? payload.subscriber
              : null,
        planId: resolvedPlanId,
        companyId:
          typeof payload.companyId === "string" && payload.companyId.trim()
            ? payload.companyId.trim()
            : null,
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
  const onChainTokenId =
    typeof payload.sourceTokenId === "string" && payload.sourceTokenId.trim()
      ? payload.sourceTokenId.trim()
      : typeof payload.tokenId === "string" && payload.tokenId.trim()
        ? payload.tokenId.trim()
        : null;
  const catalogPlanId =
    typeof payload.catalogPlanId === "string" && payload.catalogPlanId.trim()
      ? payload.catalogPlanId.trim()
      : typeof payload.planId === "string" && payload.planId.trim()
        ? payload.planId.trim()
        : null;
  const onChainPlanId =
    typeof payload.onChainPlanId === "string" ? payload.onChainPlanId : null;
  const amount = Number(payload.amount ?? 0);
  const occurredAt = options.occurredAt ?? occurredAtFromPayload ?? new Date();
  const currentPeriodEnd = resolveExpirationDate();
  const payloadChainId =
    typeof payload.chainId === "number" && Number.isFinite(payload.chainId)
      ? payload.chainId
      : null;

  let subscriptionState = null as Awaited<
    ReturnType<typeof upsertSubscriptionLedgerState>
  > | null;

  if (
    (event.eventType === "SUBSCRIPTION_MINTED" ||
      event.eventType === "SUBSCRIPTION_RENEWED") &&
    (customerWallet || companyId)
  ) {
    subscriptionState = await upsertSubscriptionLedgerState({
      teamId: event.teamId,
      environmentId: payloadEnvironmentId,
      companyId,
      walletAddress: customerWallet,
      onChainTokenId,
      chainId: payloadChainId,
      status: "ACTIVE",
      catalogPlanId,
      onChainPlanId,
      currentPeriodStart: occurredAt,
      // Preserve the existing period end when this event carries no expiration.
      // `resolveExpirationDate()` returns null for events without one (e.g. a
      // Solana `BillingExecuted` on the activation leg), and passing that null
      // through would CLEAR a period end set by the minted event — leaving an
      // ACTIVE subscription with no next billing date and blocking cancellation.
      currentPeriodEnd: currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent: options.canonicalEventName,
      lastEventAt: occurredAt,
      lastSourceTxHash:
        typeof payload.txHash === "string" ? payload.txHash : null,
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
      },
    });

    if (Number.isFinite(amount) && amount > 0) {
      await recordSuccessfulPayment({
        idempotencyKey: `payment:${event.idempotencyKey}`,
        teamId: event.teamId,
        environmentId: payloadEnvironmentId,
        companyId,
        walletAddress: customerWallet,
        onChainTokenId,
        invoiceId,
        subscriptionStateId: subscriptionState?.id,
        kind:
          event.eventType === "SUBSCRIPTION_MINTED"
            ? "SUBSCRIPTION_ACTIVATION"
            : "SUBSCRIPTION_RENEWAL",
        amount,
        currency: "USDC",
        chainId: payloadChainId ?? undefined,
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

    // Grant the plan's metered credits for the new billing period. This was
    // previously only done on the explicit activation/plan-change paths
    // (finalizeSubscriptionActivation in billing-recovery.ts and the
    // /companies/plan route), so a subscription that flowed purely through
    // the facilitator event listener ended up with an ACTIVE SubscriptionState
    // but NO CompanyCreditGrant rows for the period. resolveCreditBurnConfig
    // then found nothing and credit-burned Pro features reported
    // "Insufficient credits" -> the consumer app saw the user as free.
    //
    // Idempotent: grantPlanCreditsForCompany keys each grant by
    // planCreditGrantIdempotencyKey (companyId + planId + creditTypeId +
    // billingPeriod + periodStartedAt-UTC-day/year), so a duplicate event
    // or a replay that races finalizeSubscriptionActivation is a no-op.
    if (companyId && catalogPlanId) {
      const billingPeriod =
        payload.billingPeriod === "monthly" || payload.billingPeriod === "annual"
          ? payload.billingPeriod
          : typeof payload.billingInterval === "number" &&
              Number.isFinite(payload.billingInterval)
            ? deriveBillingPeriodFromInterval(payload.billingInterval)
            : "monthly";
      await grantPlanCreditsForCompany({
        teamId: event.teamId,
        environmentId: payloadEnvironmentId,
        companyId,
        planId: catalogPlanId,
        billingPeriod,
        periodStartedAt: occurredAt,
        periodEndsAt: currentPeriodEnd,
        metadata: {
          source: "billing-event",
          billingEventId: event.id,
          txHash: typeof payload.txHash === "string" ? payload.txHash : null,
        },
      });
    }

    // Deliver the paid-invoice receipt. Receipts were only sent from the
    // synchronous activation path, so a subscription that finalized through the
    // facilitator event listener (the Solana flow) never emailed the customer
    // their invoice. Idempotent: deduped by txHash inside the helper.
    if (invoiceId) {
      await sendPaidInvoiceReceipt({
        teamId: event.teamId,
        invoiceId,
        txHash: typeof payload.txHash === "string" ? payload.txHash : null,
      }).catch((err) => {
        console.warn(
          "[billing-events] Failed to send paid invoice receipt:",
          err,
        );
      });
    }
  }

  if (event.eventType === "PAYMENT_FAILED") {
    subscriptionState = await upsertSubscriptionLedgerState({
      teamId: event.teamId,
      environmentId: payloadEnvironmentId,
      companyId,
      walletAddress: customerWallet,
      onChainTokenId,
      chainId: payloadChainId,
      status: "PAST_DUE",
      catalogPlanId,
      onChainPlanId,
      pastDueAt: occurredAt,
      graceEndsAt: new Date(occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      lastEvent: options.canonicalEventName,
      lastEventAt: occurredAt,
      lastSourceTxHash:
        typeof payload.txHash === "string" ? payload.txHash : null,
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
      chainId: payloadChainId ?? undefined,
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

  if (event.eventType === "SUBSCRIPTION_CANCELLED") {
    subscriptionState = await upsertSubscriptionLedgerState({
      teamId: event.teamId,
      environmentId: payloadEnvironmentId,
      companyId,
      walletAddress: customerWallet,
      onChainTokenId,
      chainId: payloadChainId,
      status: "CANCELLED",
      catalogPlanId,
      onChainPlanId,
      cancelAtPeriodEnd: false,
      cancelledAt: occurredAt,
      lastEvent: options.canonicalEventName,
      lastEventAt: occurredAt,
      lastSourceTxHash:
        typeof payload.txHash === "string" ? payload.txHash : null,
      metadata: {
        source: "billing-event",
        billingEventId: event.id,
      },
    });
  }

  // A first-party platform subscription is otherwise an ordinary customer
  // subscription. Project it only after its canonical ledger mutation succeeds.
  // Use the resolved companyId from the subscription state (upsertSubscriptionLedgerState
  // resolves the company by wallet when payload.companyId is missing). The facilitator
  // often omits companyId from the BillingExecuted payload, so relying solely on
  // payload.companyId silently skipped the platform-tier projection and left
  // Team.platformTier stuck at "FREE" forever.
  const resolvedCompanyId = subscriptionState?.companyId ?? companyId;
  if (resolvedCompanyId) {
    await projectPlatformBillingEntitlement({
      providerTeamId: event.teamId,
      companyId: resolvedCompanyId,
    });
  }

  await db.billingEvent.update({
    where: { id: event.id },
    data: { processed: true, processedAt: new Date() },
  });

  if (
    event.eventType === "SUBSCRIPTION_MINTED" ||
    event.eventType === "SUBSCRIPTION_RENEWED" ||
    event.eventType === "SUBSCRIPTION_CANCELLED" ||
    event.eventType === "PAYMENT_FAILED"
  ) {
    deliverWebhook(event.teamId, options.canonicalEventName, {
      billingEventId: event.id,
      eventType: event.eventType,
      companyId,
      planId: catalogPlanId,
      onChainPlanId,
      tokenId: onChainTokenId,
      customerWallet: normalizeWallet(customerWallet),
      amount: Number.isFinite(amount) ? amount : null,
      currency:
        typeof payload.currency === "string" && payload.currency.trim()
          ? payload.currency.trim()
          : "USDC",
      expiration: payload.expiration ?? null,
      txHash: typeof payload.txHash === "string" ? payload.txHash : null,
      invoiceId,
      occurredAt: occurredAt.toISOString(),
      ...(typeof payload.email === "string" && payload.email.trim()
        ? { email: payload.email.trim() }
        : {}),
      ...(typeof payload.error === "string" && payload.error.trim()
        ? { error: payload.error.trim() }
        : {}),
    }).catch((err) => {
      console.warn(
        "[billing-events] Failed to deliver payment failed webhook:",
        err,
      );
    });
  }

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
        processedNow: true,
        skipped: replayResult.skipped,
        reason: replayResult.reason,
      };
    }

    return {
      event: existing,
      invoiceId: null,
      deduped: true,
      processedNow: false,
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
    processedNow: true,
    skipped: processed.skipped,
    reason: processed.reason,
  };
}
