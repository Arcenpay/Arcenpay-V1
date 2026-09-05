import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { ingestBillingEvent } from "./billing-events.js";
import {
  updateSubscriptionChangeRequestStage,
} from "./subscription-change-requests.js";
import {
  upsertSubscriptionLedgerState,
} from "./billing-ledger.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { sendPaidInvoiceReceipt } from "./invoice-notifications.js";
import { allocateInvoiceNumber, toSix } from "./invoices.js";
import { syncCustomerUserIdentity } from "./customer-identity.js";
import { upsertScopedSubscriberEmail } from "./subscriber-emails.js";
import { grantPlanCreditsForCompany } from "./usage-credits.js";
import { asRecord, normalizeWallet } from "./utils.js";
import { normalizeWalletForChain } from "@arcenpay/internal-core";

const BILLING_RECOVERY_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
] as const;

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value);
  }
  if (typeof value === "string" && value.trim()) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      // Accept unix seconds from billing payloads.
      if (/^\d+$/.test(value.trim()) && value.trim().length <= 12) {
        return new Date(asNumber * 1000);
      }
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

export function computeBillingRecoveryNextAttemptAt(
  attemptCount: number,
  now: Date,
): Date {
  const delay =
    BILLING_RECOVERY_RETRY_DELAYS_MS[
      Math.min(
        Math.max(attemptCount - 1, 0),
        BILLING_RECOVERY_RETRY_DELAYS_MS.length - 1,
      )
    ];
  return new Date(now.getTime() + delay);
}

interface SubscriptionActivationRecoveryPayload {
  companyId: string;
  customerUserId?: string | null;
  environmentId?: string | null;
  walletAddress: string;
  catalogPlanId: string;
  catalogPlanName: string;
  billingPeriod?: "monthly" | "annual" | null;
  customerName?: string | null;
  onChainPlanId: string;
  onChainTokenId: string;
  expiration?: string | null;
  txHash: string;
  amount: number;
  currency?: string | null;
  merchantAddress?: string | null;
  acceptedToken?: string | null;
  subscriberEmail?: string | null;
  occurredAt?: string | null;
  previousPlanId?: string | null;
  /** Chain this activation happened on — threads chainFamily to ledger rows. */
  chainId?: number | null;
}

interface SubscriptionLifecycleRecoveryPayload {
  requestId: string;
  companyId: string;
  changeType?:
    | "upgrade"
    | "downgrade"
    | "cancellation"
    | "resume"
    | "billing_period_change"
    | null;
  targetPlanId?: string | null;
  effectiveAt?: string | null;
}

export interface FinalizeSubscriptionActivationInput {
  teamId: string;
  payload: SubscriptionActivationRecoveryPayload;
  taskId?: string | null;
  source?: string;
}

type ActivationBillingRecordParams = {
  occurredAt: Date;
  source: string;
  subscriptionStateId?: string | null;
};

async function findSubscriptionActivationInvoice(input: {
  client: any;
  teamId: string;
  companyId: string;
  planId: string;
  txHash: string;
}) {
  return input.client.invoice.findFirst({
    where: {
      teamId: input.teamId,
      companyId: input.companyId,
      planId: input.planId,
      metadata: {
        path: ["txHash"],
        equals: input.txHash,
      } as any,
    },
    orderBy: { issuedAt: "desc" },
  });
}

async function resolveExistingActivationBillingRecords(input: {
  txHash: string;
  idempotencyKey: string;
  teamId: string;
  companyId: string;
  planId: string;
}) {
  const existingPayment = await db.payment.findFirst({
    where: {
      OR: [
        { txHash: input.txHash },
        { idempotencyKey: input.idempotencyKey },
      ],
    },
    select: { id: true, invoiceId: true },
  });

  const invoice = existingPayment?.invoiceId
    ? await db.invoice.findUnique({ where: { id: existingPayment.invoiceId } })
    : await findSubscriptionActivationInvoice({
        client: db,
        teamId: input.teamId,
        companyId: input.companyId,
        planId: input.planId,
        txHash: input.txHash,
      });

  if (!invoice || !existingPayment) {
    return null;
  }

  return {
    invoice,
    paymentId: existingPayment.id,
  };
}

async function createOrReuseSubscriptionActivationBillingRecords(
  input: FinalizeSubscriptionActivationInput,
  params: ActivationBillingRecordParams,
) {
  const team = await db.team.findUnique({
    where: { id: input.teamId },
    select: { slug: true, invoicePrefix: true, environmentMode: true },
  });
  const prefix =
    team?.invoicePrefix ??
    (team ? `INV-${team.slug.toUpperCase()}` : "INV-ARCENPAY");
  const invoiceAmount = toSix(input.payload.amount);
  const paymentIdempotencyKey = `payment:subscription.activate:${input.payload.txHash}`;

  try {
    return await db.$transaction(async (transaction) => {
      const existingPayment = await transaction.payment.findFirst({
        where: {
          OR: [
            { txHash: input.payload.txHash },
            { idempotencyKey: paymentIdempotencyKey },
          ],
        },
        select: { id: true, invoiceId: true },
      });

      let invoice = existingPayment?.invoiceId
        ? await transaction.invoice.findUnique({
            where: { id: existingPayment.invoiceId },
          })
        : null;

      if (!invoice) {
        invoice = await findSubscriptionActivationInvoice({
          client: transaction,
          teamId: input.teamId,
          companyId: input.payload.companyId,
          planId: input.payload.catalogPlanId,
          txHash: input.payload.txHash,
        });
      }

      if (!invoice) {
        const invoiceNumber = team
          ? await allocateInvoiceNumber(input.teamId, prefix, params.occurredAt)
          : `INV-${Date.now()}`;

        invoice = await transaction.invoice.create({
          data: {
            teamId: input.teamId,
            environmentId: input.payload.environmentId ?? null,
            environmentMode: team?.environmentMode ?? "PRODUCTION",
            status: "PAID",
            number: invoiceNumber,
            currency: input.payload.currency ?? "USDC",
            customerEmail: input.payload.subscriberEmail ?? null,
            customerWallet: normalizeWallet(input.payload.walletAddress),
            subtotal: invoiceAmount,
            taxTotal: "0.000000",
            total: invoiceAmount,
            amountPaid: invoiceAmount,
            amountCredited: "0.000000",
            amountOutstanding: "0.000000",
            issuedAt: params.occurredAt,
            paidAt: params.occurredAt,
            planId: input.payload.catalogPlanId,
            companyId: input.payload.companyId,
            metadata: toPrismaJson({
              source: params.source,
              mode: "subscription_activation",
              description: `Subscription activation — ${input.payload.catalogPlanName}`,
              customerName: input.payload.customerName ?? null,
              tokenId: input.payload.onChainTokenId,
              onChainPlanId: input.payload.onChainPlanId,
              txHash: input.payload.txHash,
              ...(input.taskId ? { recoveryTaskId: input.taskId } : {}),
            }),
            lineItems: {
              create: {
                description: `Subscription activation — ${input.payload.catalogPlanName}`,
                quantity: 1,
                unitAmount: invoiceAmount,
                taxRate: "0.0000",
                lineSubtotal: invoiceAmount,
                lineTax: "0.000000",
                lineTotal: invoiceAmount,
              },
            },
          },
        });
      }

      if (existingPayment) {
        await transaction.payment.update({
          where: { id: existingPayment.id },
          data: {
            invoiceId: invoice.id,
            companyId: input.payload.companyId,
            subscriptionStateId: params.subscriptionStateId ?? null,
          },
        });
        return { invoice, paymentId: existingPayment.id };
      }

      const payment = await transaction.payment.create({
        data: {
          idempotencyKey: paymentIdempotencyKey,
          teamId: input.teamId,
          environmentId: input.payload.environmentId ?? null,
          companyId: input.payload.companyId,
          invoiceId: invoice.id,
          subscriptionStateId: params.subscriptionStateId ?? null,
          kind: "SUBSCRIPTION_ACTIVATION",
          status: "SUCCEEDED",
          amount: invoiceAmount,
          currency: input.payload.currency ?? "USDC",
          payerWallet: normalizeWallet(input.payload.walletAddress),
          recipientWallet: normalizeWallet(input.payload.merchantAddress),
          acceptedToken: normalizeWallet(input.payload.acceptedToken),
          txHash: input.payload.txHash,
          occurredAt: params.occurredAt,
          settledAt: params.occurredAt,
          metadata: toPrismaJson({
            source: params.source,
            tokenId: input.payload.onChainTokenId,
            onChainPlanId: input.payload.onChainPlanId,
            expiration: input.payload.expiration,
            ...(input.taskId ? { recoveryTaskId: input.taskId } : {}),
          }),
        },
      });

      return { invoice, paymentId: payment.id };
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingRecords = await resolveExistingActivationBillingRecords({
      txHash: input.payload.txHash,
      idempotencyKey: paymentIdempotencyKey,
      teamId: input.teamId,
      companyId: input.payload.companyId,
      planId: input.payload.catalogPlanId,
    });

    if (existingRecords) {
      return existingRecords;
    }

    throw error;
  }
}

function parseSubscriptionActivationPayload(
  payload: unknown,
): SubscriptionActivationRecoveryPayload {
  const record = asRecord(payload);

  return {
    companyId: String(record.companyId ?? ""),
    customerUserId:
      typeof record.customerUserId === "string" ? record.customerUserId : null,
    walletAddress: String(record.walletAddress ?? ""),
    catalogPlanId: String(record.catalogPlanId ?? ""),
    catalogPlanName: String(record.catalogPlanName ?? "Subscription"),
    billingPeriod:
      record.billingPeriod === "annual" ? "annual" : "monthly",
    customerName:
      typeof record.customerName === "string" ? record.customerName.trim() : null,
    onChainPlanId: String(record.onChainPlanId ?? ""),
    onChainTokenId: String(record.onChainTokenId ?? ""),
    expiration:
      typeof record.expiration === "string" ? record.expiration : null,
    txHash: String(record.txHash ?? ""),
    amount: Number(record.amount ?? 0),
    currency:
      typeof record.currency === "string" && record.currency.trim()
        ? record.currency.trim()
        : "USDC",
    merchantAddress:
      typeof record.merchantAddress === "string"
        ? record.merchantAddress
        : null,
    acceptedToken:
      typeof record.acceptedToken === "string" ? record.acceptedToken : null,
    subscriberEmail:
      typeof record.subscriberEmail === "string"
        ? record.subscriberEmail.trim()
        : null,
    occurredAt:
      typeof record.occurredAt === "string" ? record.occurredAt : null,
    previousPlanId:
      typeof record.previousPlanId === "string" ? record.previousPlanId : null,
    chainId:
      typeof record.chainId === "number"
        ? record.chainId
        : typeof record.chainId === "string" && record.chainId.trim() !== ""
          ? Number(record.chainId)
          : null,
  };
}

function parseSubscriptionLifecyclePayload(
  payload: unknown,
): SubscriptionLifecycleRecoveryPayload {
  const record = asRecord(payload);
  return {
    requestId: String(record.requestId ?? ""),
    companyId: String(record.companyId ?? ""),
    changeType:
      typeof record.changeType === "string" ? record.changeType as any : null,
    targetPlanId:
      typeof record.targetPlanId === "string" ? record.targetPlanId : null,
    effectiveAt:
      typeof record.effectiveAt === "string" ? record.effectiveAt : null,
  };
}

function isOpenLifecycleStage(stage: unknown): boolean {
  return (
    stage === "REQUESTED" ||
    stage === "PENDING_VERIFICATION" ||
    stage === "PENDING_RECOVERY"
  );
}

async function clearPendingLifecycleTraits(input: {
  companyId: string;
  requestId: string;
}) {
  const company = await db.arcenCompany.findUnique({
    where: { id: input.companyId },
    select: { traits: true },
  });
  if (!company) return;

  const traits = asRecord(company.traits);
  const transition = asRecord(traits.subscriptionTransition);
  const transitionId =
    typeof transition.transitionId === "string" ? transition.transitionId : null;
  const pendingId =
    typeof traits.pendingSubscriptionChangeRequestId === "string"
      ? traits.pendingSubscriptionChangeRequestId
      : null;

  if (transitionId !== input.requestId && pendingId !== input.requestId) {
    return;
  }

  const nextTraits = { ...traits };
  delete nextTraits.pendingSubscriptionChangeRequestId;
  if (transitionId === input.requestId) {
    delete nextTraits.subscriptionTransition;
  }

  await db.arcenCompany.update({
    where: { id: input.companyId },
    data: { traits: toPrismaJson(nextTraits) },
  });
}

export async function enqueueSubscriptionActivationRecovery(input: {
  teamId: string;
  companyId: string;
  customerUserId?: string | null;
  environmentId?: string | null;
  walletAddress: string;
  catalogPlanId: string;
  catalogPlanName: string;
  billingPeriod?: "monthly" | "annual" | null;
  customerName?: string | null;
  onChainPlanId: string;
  onChainTokenId: string;
  expiration?: string | null;
  txHash: string;
  amount: number;
  currency?: string | null;
  merchantAddress?: string | null;
  acceptedToken?: string | null;
  subscriberEmail?: string | null;
  occurredAt?: Date | null;
  previousPlanId?: string | null;
  /** Chain this activation happened on. Optional — defaults to the plan's
   *  chain when the ledger finalizes. */
  chainId?: number | null;
}) {
  const idempotencyKey = `subscription.activate:${input.txHash}`;
  const existing = await db.billingRecoveryTask.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return existing;

  return db.billingRecoveryTask.create({
    data: {
      teamId: input.teamId,
      companyId: input.companyId,
      kind: "SUBSCRIPTION_ACTIVATION",
      status: "PENDING",
      idempotencyKey,
      txHash: input.txHash,
      walletAddress: normalizeWallet(input.walletAddress),
      payload: toPrismaJson({
        companyId: input.companyId,
        customerUserId: input.customerUserId ?? null,
        environmentId: input.environmentId ?? null,
        walletAddress: normalizeWallet(input.walletAddress),
        catalogPlanId: input.catalogPlanId,
        catalogPlanName: input.catalogPlanName,
        billingPeriod: input.billingPeriod === "annual" ? "annual" : "monthly",
        customerName: input.customerName?.trim() || null,
        onChainPlanId: input.onChainPlanId,
        onChainTokenId: input.onChainTokenId,
        expiration: input.expiration ?? null,
        txHash: input.txHash,
        amount: input.amount,
        currency: input.currency ?? "USDC",
        merchantAddress: normalizeWallet(input.merchantAddress),
        acceptedToken: normalizeWallet(input.acceptedToken),
        subscriberEmail: input.subscriberEmail?.trim() || null,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        previousPlanId: input.previousPlanId ?? null,
        chainId: input.chainId ?? null,
      }),
    },
  });
}

async function processSubscriptionActivationTask(input: {
  taskId: string;
  teamId: string;
  payload: SubscriptionActivationRecoveryPayload;
}) {
  await finalizeSubscriptionActivation({
    teamId: input.teamId,
    taskId: input.taskId,
    payload: input.payload,
    source: "billing-recovery",
  });
}

async function processSubscriptionLifecycleTask(input: {
  taskId: string;
  teamId: string;
  payload: SubscriptionLifecycleRecoveryPayload;
  now: Date;
}) {
  const request = await db.subscriptionChangeRequest.findUnique({
    where: { id: input.payload.requestId },
    include: {
      company: {
        select: {
          id: true,
          environmentId: true,
          activePlanId: true,
          traits: true,
          subscriptionState: {
            select: {
              id: true,
              status: true,
              catalogPlanId: true,
              currentPeriodEnd: true,
              cancelAtPeriodEnd: true,
              cancelledAt: true,
            },
          },
        },
      },
    },
  });

  if (!request || request.teamId !== input.teamId) {
    throw new Error(
      `Billing recovery request not found for lifecycle task ${input.taskId}`,
    );
  }

  if (!isOpenLifecycleStage(request.stage)) {
    return {
      status: "already_terminal",
      requestId: request.id,
      stage: String(request.stage).toLowerCase(),
    };
  }

  const company = request.company;
  const subscriptionState = company?.subscriptionState ?? null;
  const metadata = asRecord(request.metadata);
  const targetPlanId = request.targetPlanId ?? input.payload.targetPlanId ?? null;
  const effectiveAt =
    request.effectiveAt ??
    parseDate(input.payload.effectiveAt) ??
    request.requestedAt;
  const effectiveAgeHours = effectiveAt
    ? (input.now.getTime() - effectiveAt.getTime()) / (1000 * 60 * 60)
    : 0;

  let shouldApply = false;
  let shouldFail = false;
  let failureReason: string | null = null;

  switch (request.changeType) {
    case "UPGRADE":
    case "BILLING_PERIOD_CHANGE":
      shouldApply =
        Boolean(targetPlanId) &&
        (company?.activePlanId === targetPlanId ||
          subscriptionState?.catalogPlanId === targetPlanId);
      if (!shouldApply && effectiveAgeHours >= 24) {
        shouldFail = true;
        failureReason = "recovery_failed:applied_upgrade_not_observed";
      }
      break;
    case "DOWNGRADE":
      shouldApply =
        Boolean(targetPlanId) &&
        company?.activePlanId === targetPlanId &&
        subscriptionState?.catalogPlanId === targetPlanId;
      if (!shouldApply && effectiveAgeHours >= 48) {
        shouldFail = true;
        failureReason = "stale_sync:downgrade_apply_not_observed";
      }
      break;
    case "CANCELLATION":
      shouldApply =
        subscriptionState?.status === "CANCELLED" ||
        (Boolean(targetPlanId) &&
          company?.activePlanId === targetPlanId &&
          Boolean(subscriptionState?.cancelledAt));
      if (!shouldApply && effectiveAgeHours >= 48) {
        shouldFail = true;
        failureReason = "stale_sync:cancellation_apply_not_observed";
      }
      break;
    case "RESUME":
      shouldApply = subscriptionState?.cancelAtPeriodEnd === false;
      if (!shouldApply && effectiveAgeHours >= 24) {
        shouldFail = true;
        failureReason = "recovery_failed:resume_apply_not_observed";
      }
      break;
    default:
      shouldFail = true;
      failureReason = "recovery_failed:unsupported_change_type";
      break;
  }

  if (shouldApply) {
    await updateSubscriptionChangeRequestStage({
      requestId: request.id,
      stage: "applied",
      effectiveAt: request.effectiveAt ?? input.now,
      appliedAt: input.now,
      recoveryTaskId: input.taskId,
      pendingVerification: false,
      failureReason: null,
      metadata: {
        ...metadata,
        recoveryCompletedAt: input.now.toISOString(),
        recoverySource: "billing-recovery",
      },
    });

    await clearPendingLifecycleTraits({
      companyId: request.companyId,
      requestId: request.id,
    });

    const payload = {
      companyId: request.companyId,
      environmentId: request.environmentId ?? company?.environmentId ?? null,
      transitionId: request.id,
      changeType: String(request.changeType).toLowerCase(),
      stage: "applied",
      previousPlanId: request.previousPlanId ?? null,
      targetPlanId: request.targetPlanId ?? null,
      planId: company?.activePlanId ?? request.targetPlanId ?? null,
      mode:
        typeof metadata.mode === "string" && metadata.mode.trim()
          ? metadata.mode.trim()
          : "recovered",
      scheduled:
        request.changeType === "DOWNGRADE" || request.changeType === "CANCELLATION",
      effectiveAt: (request.effectiveAt ?? input.now).toISOString(),
      source: "billing-recovery",
      recoveryTaskId: input.taskId,
    } as Record<string, unknown>;

    deliverWebhook(input.teamId, "company.plan.changed", payload).catch(
      () => {},
    );
    if (request.changeType === "CANCELLATION") {
      deliverWebhook(input.teamId, "company.plan.cancelled", payload).catch(
        () => {},
      );
    }

    return {
      status: "applied",
      requestId: request.id,
    };
  }

  if (shouldFail) {
    await updateSubscriptionChangeRequestStage({
      requestId: request.id,
      stage: "failed",
      failedAt: input.now,
      recoveryTaskId: input.taskId,
      pendingVerification: false,
      failureReason,
      metadata: {
        ...metadata,
        recoveryFailedAt: input.now.toISOString(),
        recoverySource: "billing-recovery",
      },
    });

    await clearPendingLifecycleTraits({
      companyId: request.companyId,
      requestId: request.id,
    });

    return {
      status: "failed",
      requestId: request.id,
      failureReason,
    };
  }

  await updateSubscriptionChangeRequestStage({
    requestId: request.id,
    stage: "pending_recovery",
    recoveryTaskId: input.taskId,
    metadata: {
      ...metadata,
      recoveryObservedAt: input.now.toISOString(),
      recoverySource: "billing-recovery",
    },
  });

  return {
    status: "pending_recovery",
    requestId: request.id,
  };
}

export async function finalizeSubscriptionActivation(
  input: FinalizeSubscriptionActivationInput,
) {
  const occurredAt = parseDate(input.payload.occurredAt) ?? new Date();
  const currentPeriodEnd = parseDate(input.payload.expiration);
  const source = input.source?.trim() || "billing-recovery";
  // Chain context for family-aware wallet normalization. When the recovery
  // payload doesn't carry a chainId (legacy EVM activations) default to the
  // ledger's canonical EVM chain so lowercasing behavior is unchanged.
  const walletChainId = input.payload.chainId ?? 84532;

  if (input.payload.subscriberEmail) {
    await upsertScopedSubscriberEmail({
      teamId: input.teamId,
      environmentId: input.payload.environmentId ?? null,
      companyId: input.payload.companyId,
      walletAddress: input.payload.walletAddress,
      email: input.payload.subscriberEmail,
      planId: input.payload.catalogPlanId,
    });
  }

  const subscriptionState = await upsertSubscriptionLedgerState({
    teamId: input.teamId,
    environmentId: input.payload.environmentId ?? null,
    companyId: input.payload.companyId,
    walletAddress: input.payload.walletAddress,
    status: "ACTIVE",
    catalogPlanId: input.payload.catalogPlanId,
    onChainPlanId: input.payload.onChainPlanId,
    onChainTokenId: input.payload.onChainTokenId,
    ...(input.payload.chainId != null
      ? { chainId: input.payload.chainId }
      : {}),
    currentPeriodStart: occurredAt,
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    lastEvent: "subscription.minted",
    lastEventAt: occurredAt,
    lastSourceTxHash: input.payload.txHash,
    metadata: {
      source,
      billingPeriod: input.payload.billingPeriod ?? "monthly",
      ...(input.taskId ? { recoveryTaskId: input.taskId } : {}),
    },
  });

  const company = await db.arcenCompany.findUnique({
    where: { id: input.payload.companyId },
    select: {
      name: true,
      email: true,
      walletAddress: true,
      traits: true,
    },
  });
  const currentTraits = asRecord(company?.traits);
  const currentTransition = asRecord(currentTraits.subscriptionTransition);
  const nextTraits = { ...currentTraits };
  if (currentTransition.mode === "cancel_at_period_end") {
    delete nextTraits.subscriptionTransition;
  }
  nextTraits.billingPeriod = input.payload.billingPeriod ?? "monthly";

  const companyUpdate = {
    activePlanId: input.payload.catalogPlanId,
    traits: toPrismaJson(nextTraits),
    ...(input.payload.walletAddress &&
    company?.walletAddress &&
    normalizeWalletForChain(input.payload.walletAddress, walletChainId) !==
      normalizeWalletForChain(company.walletAddress, walletChainId)
      ? {
          walletAddress:
            normalizeWalletForChain(input.payload.walletAddress, walletChainId) ??
            input.payload.walletAddress,
        }
      : {}),
    ...(input.payload.subscriberEmail &&
    company?.email?.trim().toLowerCase() !==
      input.payload.subscriberEmail.trim().toLowerCase()
      ? { email: input.payload.subscriberEmail.trim().toLowerCase() }
      : {}),
    ...(input.payload.customerName &&
    company?.name?.trim() !== input.payload.customerName.trim()
      ? { name: input.payload.customerName.trim() }
      : {}),
  };

  await db.arcenCompany.update({
    where: { id: input.payload.companyId },
    data: companyUpdate,
  });

  await grantPlanCreditsForCompany({
    teamId: input.teamId,
    environmentId: input.payload.environmentId ?? null,
    companyId: input.payload.companyId,
    planId: input.payload.catalogPlanId,
    billingPeriod: input.payload.billingPeriod ?? "monthly",
    periodStartedAt: occurredAt,
    periodEndsAt: currentPeriodEnd,
    metadata: {
      source,
      txHash: input.payload.txHash,
      recoveryTaskId: input.taskId ?? null,
    },
  });

  await syncCustomerUserIdentity({
    companyId: input.payload.companyId,
    userId: input.payload.customerUserId ?? null,
    customerName: input.payload.customerName ?? null,
    customerEmail: input.payload.subscriberEmail ?? null,
    walletAddress: input.payload.walletAddress,
  });

  // Create invoice + record payment in one idempotent transaction. If a retry
  // races the original confirmation, the unique Payment keys roll back the
  // duplicate invoice attempt and we reuse the original rows.
  const { invoice, paymentId } =
    await createOrReuseSubscriptionActivationBillingRecords(input, {
      occurredAt,
      source,
      subscriptionStateId: subscriptionState?.id,
    });

  // Ingest the billing event as a secondary operation (webhooks + subscription sync).
  // The invoice and payment are already persisted above, so this is non-blocking.
  const billingEvent = await ingestBillingEvent({
    teamId: input.teamId,
    eventType: "SUBSCRIPTION_MINTED",
    eventName: "subscription.minted",
    idempotencyKey: `subscription.minted:${input.payload.txHash}`,
    source,
    occurredAt,
    triggerInvoice: false, // Invoice already created above
    payload: {
      tokenId: input.payload.onChainTokenId,
      planId: input.payload.catalogPlanId,
      catalogPlanId: input.payload.catalogPlanId,
      onChainPlanId: input.payload.onChainPlanId,
      companyId: input.payload.companyId,
      environmentId: input.payload.environmentId ?? null,
      customerWallet: normalizeWallet(input.payload.walletAddress),
      subscriber: normalizeWallet(input.payload.walletAddress),
      amount: input.payload.amount,
      expiration: input.payload.expiration,
      txHash: input.payload.txHash,
      description: `Subscription activation — ${input.payload.catalogPlanName}`,
      ...(input.payload.customerName
        ? { customerName: input.payload.customerName }
        : {}),
      ...(input.payload.subscriberEmail
        ? { email: input.payload.subscriberEmail }
        : {}),
    },
  });

  if (billingEvent.processedNow) {
    deliverWebhook(input.teamId, "company.plan.changed", {
      companyId: input.payload.companyId,
      planId: input.payload.catalogPlanId,
      planName: input.payload.catalogPlanName,
      previousPlanId: input.payload.previousPlanId ?? null,
      txHash: input.payload.txHash,
      source,
      invoiceId: invoice.id,
    }).catch((err) => {
      console.warn("[billing-recovery] Failed to deliver webhook:", err);
    });
  }

  await sendPaidInvoiceReceipt({
    teamId: input.teamId,
    invoiceId: invoice.id,
    txHash: input.payload.txHash,
  }).catch((err) => {
    console.warn("[billing-recovery] Failed to send invoice receipt:", err);
  });

  // Always project platform billing entitlement after activation.
  // This ensures the workspace tier is updated even if the billing
  // event was deduped (facilitator already processed it) or if the
  // event processing path didn't call projectPlatformBillingEntitlement.
  try {
    const { projectPlatformBillingEntitlement } = await import("./platform-billing-customer.js");
    await projectPlatformBillingEntitlement({
      providerTeamId: input.teamId,
      companyId: input.payload.companyId,
    });
  } catch (err) {
    console.warn("[billing-recovery] Failed to project platform billing entitlement:", err);
  }

  return {
    subscriptionState,
    invoiceId: invoice.id,
    paymentId,
    eventDeduped: billingEvent.deduped,
  };
}

export async function processBillingRecoveryTask(input: {
  taskId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const claimed = await db.billingRecoveryTask.updateMany({
    where: {
      id: input.taskId,
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: {
      status: "PROCESSING",
      attempts: { increment: 1 },
      lastAttemptAt: now,
      lastError: null,
    },
  });

  if (claimed.count === 0) {
    const task = await db.billingRecoveryTask.findUnique({
      where: { id: input.taskId },
      select: { id: true, status: true, attempts: true, nextAttemptAt: true },
    });
    return {
      ok: Boolean(task?.status === "COMPLETED"),
      claimed: false,
      task,
    };
  }

  const task = await db.billingRecoveryTask.findUnique({
    where: { id: input.taskId },
  });
  if (!task) {
    return {
      ok: false,
      claimed: true,
      task: null,
    };
  }

  try {
    switch (task.kind) {
      case "SUBSCRIPTION_ACTIVATION":
        await processSubscriptionActivationTask({
          taskId: task.id,
          teamId: task.teamId,
          payload: parseSubscriptionActivationPayload(task.payload),
        });
        break;
      case "SUBSCRIPTION_PLAN_CHANGE":
      case "SUBSCRIPTION_CANCELLATION":
      case "SUBSCRIPTION_RESUME":
        await processSubscriptionLifecycleTask({
          taskId: task.id,
          teamId: task.teamId,
          payload: parseSubscriptionLifecyclePayload(task.payload),
          now,
        });
        break;
      default:
        throw new Error(`Unsupported billing recovery task kind: ${task.kind}`);
    }

    const completedTask = await db.billingRecoveryTask.update({
      where: { id: task.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        nextAttemptAt: null,
        lastError: null,
      },
    });

    return {
      ok: true,
      claimed: true,
      task: completedTask,
    };
  } catch (error) {
    const lastError =
      error instanceof Error ? error.message : "Billing recovery failed";
    const failedTask = await db.billingRecoveryTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        lastError,
        nextAttemptAt: computeBillingRecoveryNextAttemptAt(task.attempts, now),
      },
    });

    return {
      ok: false,
      claimed: true,
      task: failedTask,
      error: lastError,
    };
  }
}

export async function processPendingBillingRecoveryTasks(input: {
  teamId: string;
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const tasks = await db.billingRecoveryTask.findMany({
    where: {
      teamId: input.teamId,
      status: { in: ["PENDING", "FAILED"] },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: [{ createdAt: "asc" }, { updatedAt: "asc" }],
    take: input.limit ?? 50,
    select: { id: true, kind: true, status: true, attempts: true },
  });

  const results = [];
  for (const task of tasks) {
    const result = await processBillingRecoveryTask({
      taskId: task.id,
      now,
    });
    results.push(result);
  }

  return {
    scanned: tasks.length,
    completed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => result.claimed && !result.ok).length,
    skipped: results.filter((result) => !result.claimed).length,
    results,
  };
}
