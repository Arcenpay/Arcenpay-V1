import { db } from "../../db.js";
import { countLegacySubscriptionTransitions } from "./subscription-change-requests.js";
import { asRecord } from "./utils.js";

function isOpenLifecycleStage(stage: string | null | undefined): boolean {
  return (
    stage === "REQUESTED" ||
    stage === "PENDING_VERIFICATION" ||
    stage === "PENDING_RECOVERY"
  );
}

function hoursBetween(earlier: Date | null | undefined, later: Date): number {
  if (!earlier) return 0;
  return (later.getTime() - earlier.getTime()) / (1000 * 60 * 60);
}

export async function getBillingRuntimeSummary(input: {
  teamId: string;
  now?: Date;
  limit?: number;
}) {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const recentCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [
    pendingVerificationCount,
    pendingRecoveryCount,
    openLifecycleCount,
    openRequests,
    failedRequests,
    recoveryPendingCount,
    recoveryProcessingCount,
    recoveryFailedCount,
    failedRecoveryTasks,
    recentWebhookFailureCount,
    recentWebhookFailures,
    legacyTransitions,
  ] = await Promise.all([
    db.subscriptionChangeRequest.count({
      where: {
        teamId: input.teamId,
        stage: "PENDING_VERIFICATION",
      },
    }),
    db.subscriptionChangeRequest.count({
      where: {
        teamId: input.teamId,
        stage: "PENDING_RECOVERY",
      },
    }),
    db.subscriptionChangeRequest.count({
      where: {
        teamId: input.teamId,
        stage: {
          in: ["REQUESTED", "PENDING_VERIFICATION", "PENDING_RECOVERY"],
        },
      },
    }),
    db.subscriptionChangeRequest.findMany({
      where: {
        teamId: input.teamId,
        stage: {
          in: ["REQUESTED", "PENDING_VERIFICATION", "PENDING_RECOVERY"],
        },
      },
      orderBy: [{ requestedAt: "asc" }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        companyId: true,
        changeType: true,
        stage: true,
        requestedAt: true,
        effectiveAt: true,
        previousPlanId: true,
        targetPlanId: true,
        targetBillingPeriod: true,
        pendingVerification: true,
        failureReason: true,
        metadata: true,
      },
    }),
    db.subscriptionChangeRequest.findMany({
      where: {
        teamId: input.teamId,
        stage: "FAILED",
      },
      orderBy: [{ failedAt: "desc" }, { updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        companyId: true,
        changeType: true,
        requestedAt: true,
        effectiveAt: true,
        failedAt: true,
        failureReason: true,
        metadata: true,
      },
    }),
    db.billingRecoveryTask.count({
      where: {
        teamId: input.teamId,
        status: "PENDING",
      },
    }),
    db.billingRecoveryTask.count({
      where: {
        teamId: input.teamId,
        status: "PROCESSING",
      },
    }),
    db.billingRecoveryTask.count({
      where: {
        teamId: input.teamId,
        status: "FAILED",
      },
    }),
    db.billingRecoveryTask.findMany({
      where: {
        teamId: input.teamId,
        status: "FAILED",
      },
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      select: {
        id: true,
        kind: true,
        companyId: true,
        attempts: true,
        nextAttemptAt: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    db.webhookDelivery.count({
      where: {
        teamId: input.teamId,
        success: false,
        deliveredAt: { gte: recentCutoff },
      },
    }),
    db.webhookDelivery.findMany({
      where: {
        teamId: input.teamId,
        success: false,
      },
      orderBy: [{ deliveredAt: "desc" }],
      take: limit,
      select: {
        deliveryId: true,
        event: true,
        url: true,
        statusCode: true,
        attemptNumber: true,
        deliveredAt: true,
        error: true,
      },
    }),
    countLegacySubscriptionTransitions({
      teamId: input.teamId,
    }),
  ]);

  let awaitingOnChainSyncCount = 0;
  let staleSyncCount = 0;
  const derivedOpenRequests = openRequests.map((request) => {
    const metadata = asRecord(request.metadata);
    const requiresOnChainSync = Boolean(metadata.requiresOnChainSync);
    const effectiveAt = request.effectiveAt ?? request.requestedAt;
    const ageHours = Math.round(hoursBetween(effectiveAt, now) * 10) / 10;
    const awaitingOnChainSync =
      requiresOnChainSync &&
      isOpenLifecycleStage(request.stage) &&
      effectiveAt instanceof Date &&
      effectiveAt <= now;
    const staleSync = awaitingOnChainSync && ageHours >= 48;

    if (awaitingOnChainSync) awaitingOnChainSyncCount += 1;
    if (staleSync) staleSyncCount += 1;

    return {
      id: request.id,
      companyId: request.companyId,
      changeType: String(request.changeType).toLowerCase(),
      stage: String(request.stage).toLowerCase(),
      requestedAt: request.requestedAt?.toISOString() ?? null,
      effectiveAt: request.effectiveAt?.toISOString() ?? null,
      previousPlanId: request.previousPlanId,
      targetPlanId: request.targetPlanId,
      targetBillingPeriod: request.targetBillingPeriod,
      pendingVerification: request.pendingVerification,
      pendingRecovery: request.stage === "PENDING_RECOVERY",
      requiresOnChainSync,
      awaitingOnChainSync,
      staleSync,
      ageHours,
      mode:
        typeof metadata.mode === "string" && metadata.mode.trim()
          ? metadata.mode.trim()
          : null,
      targetPlanName:
        typeof metadata.targetPlanName === "string"
          ? metadata.targetPlanName
          : null,
    };
  });

  const derivedFailedRequests = failedRequests.map((request) => {
    const metadata = asRecord(request.metadata);
    const failureReason = request.failureReason ?? null;
    const staleSync =
      Boolean(failureReason?.includes("stale")) ||
      Boolean(failureReason?.includes("on_chain_renewal_not_detected"));
    if (staleSync) staleSyncCount += 1;
    return {
      id: request.id,
      companyId: request.companyId,
      changeType: String(request.changeType).toLowerCase(),
      requestedAt: request.requestedAt?.toISOString() ?? null,
      effectiveAt: request.effectiveAt?.toISOString() ?? null,
      failedAt: request.failedAt?.toISOString() ?? null,
      failureReason,
      staleSync,
      mode:
        typeof metadata.mode === "string" && metadata.mode.trim()
          ? metadata.mode.trim()
          : null,
    };
  });

  return {
    generatedAt: now.toISOString(),
    teamId: input.teamId,
    openLifecycleRequests: {
      total: openLifecycleCount,
      pendingVerification: pendingVerificationCount,
      pendingRecovery: pendingRecoveryCount,
      awaitingOnChainSync: awaitingOnChainSyncCount,
      sample: derivedOpenRequests,
    },
    failedLifecycleRequests: {
      staleSync: staleSyncCount,
      sample: derivedFailedRequests,
    },
    recoveryTasks: {
      pending: recoveryPendingCount,
      processing: recoveryProcessingCount,
      failed: recoveryFailedCount,
      sample: failedRecoveryTasks.map((task) => ({
        id: task.id,
        kind: task.kind.toLowerCase(),
        companyId: task.companyId,
        attempts: task.attempts,
        nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
        lastError: task.lastError,
        updatedAt: task.updatedAt.toISOString(),
      })),
    },
    webhookDeliveries: {
      recentFailures24h: recentWebhookFailureCount,
      sample: recentWebhookFailures.map((delivery) => ({
        deliveryId: delivery.deliveryId,
        event: delivery.event,
        url: delivery.url,
        statusCode: delivery.statusCode,
        attemptNumber: delivery.attemptNumber,
        deliveredAt: delivery.deliveredAt.toISOString(),
        error: delivery.error,
      })),
    },
    legacyTransitions,
  };
}
