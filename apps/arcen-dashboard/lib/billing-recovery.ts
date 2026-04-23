import { db } from "@/lib/db";
import { toPrismaJson } from "@/lib/prisma-json";
import { ingestBillingEvent } from "@/lib/billing-events";
import {
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "@/lib/billing-ledger";
import { deliverWebhook } from "@/lib/deliver-webhook";

const BILLING_RECOVERY_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeWallet(value?: string | null): string | null {
  return value?.trim() ? value.trim().toLowerCase() : null;
}

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
  walletAddress: string;
  catalogPlanId: string;
  catalogPlanName: string;
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
}

function parseSubscriptionActivationPayload(
  payload: unknown,
): SubscriptionActivationRecoveryPayload {
  const record = asRecord(payload);

  return {
    companyId: String(record.companyId ?? ""),
    walletAddress: String(record.walletAddress ?? ""),
    catalogPlanId: String(record.catalogPlanId ?? ""),
    catalogPlanName: String(record.catalogPlanName ?? "Subscription"),
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
  };
}

export async function enqueueSubscriptionActivationRecovery(input: {
  teamId: string;
  companyId: string;
  walletAddress: string;
  catalogPlanId: string;
  catalogPlanName: string;
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
        walletAddress: normalizeWallet(input.walletAddress),
        catalogPlanId: input.catalogPlanId,
        catalogPlanName: input.catalogPlanName,
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
      }),
    },
  });
}

async function processSubscriptionActivationTask(input: {
  taskId: string;
  teamId: string;
  payload: SubscriptionActivationRecoveryPayload;
}) {
  const occurredAt = parseDate(input.payload.occurredAt) ?? new Date();
  const currentPeriodEnd = parseDate(input.payload.expiration);

  await db.arcenCompany.update({
    where: { id: input.payload.companyId },
    data: {
      walletAddress: normalizeWallet(input.payload.walletAddress),
      activePlanId: input.payload.catalogPlanId,
    },
  });

  if (input.payload.subscriberEmail) {
    await db.subscriberEmail.upsert({
      where: { walletAddress: normalizeWallet(input.payload.walletAddress)! },
      update: {
        email: input.payload.subscriberEmail,
        planId: input.payload.catalogPlanId,
      },
      create: {
        walletAddress: normalizeWallet(input.payload.walletAddress)!,
        email: input.payload.subscriberEmail,
        planId: input.payload.catalogPlanId,
      },
    });
  }

  const subscriptionState = await upsertSubscriptionLedgerState({
    teamId: input.teamId,
    companyId: input.payload.companyId,
    walletAddress: input.payload.walletAddress,
    status: "ACTIVE",
    catalogPlanId: input.payload.catalogPlanId,
    onChainPlanId: input.payload.onChainPlanId,
    onChainTokenId: input.payload.onChainTokenId,
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
      source: "billing-recovery",
      recoveryTaskId: input.taskId,
    },
  });

  await recordSuccessfulPayment({
    idempotencyKey: `payment:subscription.activate:${input.payload.txHash}`,
    teamId: input.teamId,
    companyId: input.payload.companyId,
    walletAddress: input.payload.walletAddress,
    subscriptionStateId: subscriptionState?.id,
    kind: "SUBSCRIPTION_ACTIVATION",
    amount: input.payload.amount,
    currency: input.payload.currency ?? "USDC",
    payerWallet: input.payload.walletAddress,
    recipientWallet: input.payload.merchantAddress,
    acceptedToken: input.payload.acceptedToken,
    txHash: input.payload.txHash,
    occurredAt,
    settledAt: occurredAt,
    metadata: {
      source: "billing-recovery",
      recoveryTaskId: input.taskId,
      tokenId: input.payload.onChainTokenId,
      onChainPlanId: input.payload.onChainPlanId,
      expiration: input.payload.expiration,
    },
  });

  await ingestBillingEvent({
    teamId: input.teamId,
    eventType: "SUBSCRIPTION_MINTED",
    eventName: "subscription.minted",
    idempotencyKey: `subscription.minted:${input.payload.txHash}`,
    source: "billing-recovery",
    occurredAt,
    triggerInvoice: true,
    payload: {
      tokenId: input.payload.onChainTokenId,
      planId: input.payload.catalogPlanId,
      onChainPlanId: input.payload.onChainPlanId,
      companyId: input.payload.companyId,
      customerWallet: normalizeWallet(input.payload.walletAddress),
      subscriber: normalizeWallet(input.payload.walletAddress),
      amount: input.payload.amount,
      expiration: input.payload.expiration,
      txHash: input.payload.txHash,
      description: `Subscription activation — ${input.payload.catalogPlanName}`,
      ...(input.payload.subscriberEmail
        ? { email: input.payload.subscriberEmail }
        : {}),
    },
  });

  deliverWebhook(input.teamId, "company.plan.changed", {
    companyId: input.payload.companyId,
    planId: input.payload.catalogPlanId,
    planName: input.payload.catalogPlanName,
    previousPlanId: input.payload.previousPlanId ?? null,
    txHash: input.payload.txHash,
    source: "subscription.activate",
  }).catch(() => {});
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
