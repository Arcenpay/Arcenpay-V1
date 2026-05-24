import type { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

type SubscriptionChangeDb = Pick<
  typeof db,
  "subscriptionChangeRequest" | "arcenCompany"
>;

type DbClient = SubscriptionChangeDb | Prisma.TransactionClient;

export type SubscriptionLifecycleBillingPeriod = "monthly" | "annual";
export type SubscriptionLifecycleChangeType =
  | "upgrade"
  | "downgrade"
  | "cancellation"
  | "resume"
  | "billing_period_change";
export type SubscriptionLifecycleStage =
  | "requested"
  | "pending_verification"
  | "pending_recovery"
  | "applied"
  | "failed"
  | "reverted";
export type SubscriptionLifecycleSource =
  | "self_service"
  | "admin"
  | "recovery"
  | "sync";

type SerializedSubscriptionChangeRequest = {
  id: string;
  teamId?: string | null;
  environmentId?: string | null;
  companyId?: string | null;
  subscriptionStateId?: string | null;
  changeType: SubscriptionLifecycleChangeType;
  stage: SubscriptionLifecycleStage;
  source: SubscriptionLifecycleSource;
  previousPlanId: string | null;
  targetPlanId: string | null;
  previousBillingPeriod: SubscriptionLifecycleBillingPeriod | null;
  targetBillingPeriod: SubscriptionLifecycleBillingPeriod | null;
  requestedAt: string | null;
  effectiveAt: string | null;
  appliedAt: string | null;
  failedAt: string | null;
  autopayConfigTxHash: string | null;
  accessChangeTxHash: string | null;
  paymentTxHash: string | null;
  autopayControlTxHash: string | null;
  recoveryTaskId: string | null;
  pendingVerification: boolean;
  pendingRecovery: boolean;
  failureReason: string | null;
  metadata: Record<string, unknown>;
  mode: string | null;
  targetPlanName?: string | null;
};

type SubscriptionChangeCreateInput = {
  teamId: string;
  environmentId?: string | null;
  companyId: string;
  subscriptionStateId?: string | null;
  changeType: SubscriptionLifecycleChangeType;
  stage?: SubscriptionLifecycleStage;
  source?: SubscriptionLifecycleSource;
  previousPlanId?: string | null;
  targetPlanId?: string | null;
  previousBillingPeriod?: SubscriptionLifecycleBillingPeriod | null;
  targetBillingPeriod?: SubscriptionLifecycleBillingPeriod | null;
  requestedAt?: Date | null;
  effectiveAt?: Date | null;
  appliedAt?: Date | null;
  failedAt?: Date | null;
  autopayConfigTxHash?: string | null;
  accessChangeTxHash?: string | null;
  paymentTxHash?: string | null;
  autopayControlTxHash?: string | null;
  recoveryTaskId?: string | null;
  pendingVerification?: boolean;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
};

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function stripLegacySubscriptionLifecycleTraits(
  traits: unknown,
): Record<string, unknown> {
  const nextTraits = { ...asRecord(traits) };
  delete nextTraits.subscriptionTransition;
  delete nextTraits.pendingSubscriptionChangeRequestId;
  return nextTraits;
}

export function normalizeLifecycleBillingPeriod(
  value: unknown,
): SubscriptionLifecycleBillingPeriod | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") return "annual";
  if (normalized === "monthly" || normalized === "month") return "monthly";
  return null;
}

function toDbChangeType(
  value: SubscriptionLifecycleChangeType,
):
  | "UPGRADE"
  | "DOWNGRADE"
  | "CANCELLATION"
  | "RESUME"
  | "BILLING_PERIOD_CHANGE" {
  switch (value) {
    case "upgrade":
      return "UPGRADE";
    case "downgrade":
      return "DOWNGRADE";
    case "cancellation":
      return "CANCELLATION";
    case "resume":
      return "RESUME";
    default:
      return "BILLING_PERIOD_CHANGE";
  }
}

function fromDbChangeType(value: unknown): SubscriptionLifecycleChangeType {
  switch (String(value ?? "")) {
    case "UPGRADE":
      return "upgrade";
    case "DOWNGRADE":
      return "downgrade";
    case "CANCELLATION":
      return "cancellation";
    case "RESUME":
      return "resume";
    default:
      return "billing_period_change";
  }
}

function toDbStage(
  value: SubscriptionLifecycleStage,
):
  | "REQUESTED"
  | "PENDING_VERIFICATION"
  | "PENDING_RECOVERY"
  | "APPLIED"
  | "FAILED"
  | "REVERTED" {
  switch (value) {
    case "requested":
      return "REQUESTED";
    case "pending_verification":
      return "PENDING_VERIFICATION";
    case "pending_recovery":
      return "PENDING_RECOVERY";
    case "applied":
      return "APPLIED";
    case "failed":
      return "FAILED";
    default:
      return "REVERTED";
  }
}

function fromDbStage(value: unknown): SubscriptionLifecycleStage {
  switch (String(value ?? "")) {
    case "REQUESTED":
      return "requested";
    case "PENDING_VERIFICATION":
      return "pending_verification";
    case "PENDING_RECOVERY":
      return "pending_recovery";
    case "APPLIED":
      return "applied";
    case "FAILED":
      return "failed";
    default:
      return "reverted";
  }
}

function toDbSource(
  value: SubscriptionLifecycleSource,
): "SELF_SERVICE" | "ADMIN" | "RECOVERY" | "SYNC" {
  switch (value) {
    case "self_service":
      return "SELF_SERVICE";
    case "admin":
      return "ADMIN";
    case "recovery":
      return "RECOVERY";
    default:
      return "SYNC";
  }
}

function fromDbSource(value: unknown): SubscriptionLifecycleSource {
  switch (String(value ?? "")) {
    case "SELF_SERVICE":
      return "self_service";
    case "ADMIN":
      return "admin";
    case "RECOVERY":
      return "recovery";
    default:
      return "sync";
  }
}

export function lifecycleModeForRequest(input: {
  changeType: SubscriptionLifecycleChangeType;
  stage: SubscriptionLifecycleStage;
  pendingVerification?: boolean;
  metadata?: Record<string, unknown>;
}): string | null {
  const metadata = input.metadata ?? {};
  if (typeof metadata.mode === "string" && metadata.mode.trim()) {
    return metadata.mode.trim();
  }

  switch (input.changeType) {
    case "upgrade":
      if (input.stage === "applied") return "immediate_prorated_upgrade";
      if (input.stage === "pending_recovery") {
        return "immediate_prorated_upgrade_pending";
      }
      return "immediate_prorated_upgrade_requested";
    case "downgrade":
      return input.stage === "applied"
        ? "downgrade_completed"
        : "period_end_downgrade";
    case "cancellation":
      if (input.stage === "applied") return "cancellation_completed";
      return input.pendingVerification
        ? "cancel_at_period_end_pending_verification"
        : "cancel_at_period_end";
    case "resume":
      return input.stage === "applied" ? "resume_applied" : "resume_requested";
    default:
      return input.stage === "applied" ? "billing_period_changed" : "period_end";
  }
}

export function serializeSubscriptionChangeRequest(
  request: Record<string, unknown> | null | undefined,
): SerializedSubscriptionChangeRequest | null {
  if (!request) return null;

  const metadata = asRecord(request.metadata);
  const changeType = fromDbChangeType(request.changeType);
  const stage = fromDbStage(request.stage);
  const pendingVerification = Boolean(request.pendingVerification);

  return {
    id:
      typeof request.id === "string" && request.id.trim()
        ? request.id
        : "subscription-change-request",
    teamId: typeof request.teamId === "string" ? request.teamId : null,
    environmentId:
      typeof request.environmentId === "string" ? request.environmentId : null,
    companyId: typeof request.companyId === "string" ? request.companyId : null,
    subscriptionStateId:
      typeof request.subscriptionStateId === "string"
        ? request.subscriptionStateId
        : null,
    changeType,
    stage,
    source: fromDbSource(request.source),
    previousPlanId:
      typeof request.previousPlanId === "string" ? request.previousPlanId : null,
    targetPlanId:
      typeof request.targetPlanId === "string" ? request.targetPlanId : null,
    previousBillingPeriod: normalizeLifecycleBillingPeriod(
      request.previousBillingPeriod,
    ),
    targetBillingPeriod: normalizeLifecycleBillingPeriod(
      request.targetBillingPeriod,
    ),
    requestedAt:
      request.requestedAt instanceof Date
        ? request.requestedAt.toISOString()
        : typeof request.requestedAt === "string"
          ? request.requestedAt
          : null,
    effectiveAt:
      request.effectiveAt instanceof Date
        ? request.effectiveAt.toISOString()
        : typeof request.effectiveAt === "string"
          ? request.effectiveAt
          : null,
    appliedAt:
      request.appliedAt instanceof Date
        ? request.appliedAt.toISOString()
        : typeof request.appliedAt === "string"
          ? request.appliedAt
          : null,
    failedAt:
      request.failedAt instanceof Date
        ? request.failedAt.toISOString()
        : typeof request.failedAt === "string"
          ? request.failedAt
          : null,
    autopayConfigTxHash:
      typeof request.autopayConfigTxHash === "string"
        ? request.autopayConfigTxHash
        : null,
    accessChangeTxHash:
      typeof request.accessChangeTxHash === "string"
        ? request.accessChangeTxHash
        : null,
    paymentTxHash:
      typeof request.paymentTxHash === "string" ? request.paymentTxHash : null,
    autopayControlTxHash:
      typeof request.autopayControlTxHash === "string"
        ? request.autopayControlTxHash
        : null,
    recoveryTaskId:
      typeof request.recoveryTaskId === "string" ? request.recoveryTaskId : null,
    pendingVerification,
    pendingRecovery: stage === "pending_recovery",
    failureReason:
      typeof request.failureReason === "string" ? request.failureReason : null,
    metadata,
    mode: lifecycleModeForRequest({
      changeType,
      stage,
      pendingVerification,
      metadata,
    }),
    targetPlanName:
      typeof metadata.targetPlanName === "string" ? metadata.targetPlanName : null,
  };
}

function legacyTransitionToRequest(input: {
  teamId: string;
  environmentId?: string | null;
  companyId: string;
  subscriptionStateId?: string | null;
  traits: unknown;
}): SerializedSubscriptionChangeRequest | null {
  const traits = asRecord(input.traits);
  const transition = asRecord(traits.subscriptionTransition);
  const mode = typeof transition.mode === "string" ? transition.mode : null;
  if (!mode) return null;

  const pendingVerification = Boolean(
    asRecord(transition.autopayControl).pendingVerification ??
      transition.pendingVerification,
  );

  let changeType: SubscriptionLifecycleChangeType = "billing_period_change";
  let stage: SubscriptionLifecycleStage = "requested";

  if (mode === "cancel_at_period_end") {
    changeType = "cancellation";
    stage = pendingVerification ? "pending_verification" : "requested";
  } else if (
    mode === "period_end_downgrade" ||
    mode === "next_renewal_on_chain"
  ) {
    changeType = "downgrade";
  } else if (mode === "immediate_prorated_upgrade") {
    changeType = "upgrade";
    stage = "applied";
  } else if (mode === "cancellation_completed") {
    changeType = "cancellation";
    stage = "applied";
  } else if (mode === "downgrade_completed") {
    changeType = "downgrade";
    stage = "applied";
  }

  return {
    id: `legacy-${input.companyId}`,
    teamId: input.teamId,
    environmentId: input.environmentId ?? null,
    companyId: input.companyId,
    subscriptionStateId: input.subscriptionStateId ?? null,
    changeType,
    stage,
    source: "self_service",
    previousPlanId:
      typeof transition.previousPlanId === "string"
        ? transition.previousPlanId
        : null,
    targetPlanId:
      typeof transition.targetPlanId === "string" ? transition.targetPlanId : null,
    previousBillingPeriod: normalizeLifecycleBillingPeriod(
      transition.previousBillingPeriod,
    ),
    targetBillingPeriod: normalizeLifecycleBillingPeriod(
      transition.targetBillingPeriod,
    ),
    requestedAt:
      typeof transition.requestedAt === "string" ? transition.requestedAt : null,
    effectiveAt:
      typeof transition.effectiveAt === "string" ? transition.effectiveAt : null,
    appliedAt: stage === "applied" ? new Date().toISOString() : null,
    failedAt: null,
    autopayConfigTxHash:
      typeof transition.autopayConfigTxHash === "string"
        ? transition.autopayConfigTxHash
        : null,
    accessChangeTxHash:
      typeof transition.accessChangeTxHash === "string"
        ? transition.accessChangeTxHash
        : null,
    paymentTxHash:
      typeof transition.paymentTxHash === "string" ? transition.paymentTxHash : null,
    autopayControlTxHash:
      typeof transition.autopayControlTxHash === "string"
        ? transition.autopayControlTxHash
        : null,
    recoveryTaskId: null,
    pendingVerification,
    pendingRecovery: false,
    failureReason: null,
    metadata: transition,
    mode,
    targetPlanName:
      typeof transition.targetPlanName === "string"
        ? transition.targetPlanName
        : null,
  };
}

function legacyTransitionToCreateInput(input: {
  teamId: string;
  environmentId?: string | null;
  companyId: string;
  subscriptionStateId?: string | null;
  traits: unknown;
}): SubscriptionChangeCreateInput | null {
  const legacy = legacyTransitionToRequest(input);
  if (!legacy) return null;

  return {
    teamId: input.teamId,
    environmentId: input.environmentId ?? null,
    companyId: input.companyId,
    subscriptionStateId: input.subscriptionStateId ?? null,
    changeType: legacy.changeType,
    stage: legacy.stage,
    source: legacy.source,
    previousPlanId: legacy.previousPlanId,
    targetPlanId: legacy.targetPlanId,
    previousBillingPeriod: legacy.previousBillingPeriod,
    targetBillingPeriod: legacy.targetBillingPeriod,
    requestedAt: legacy.requestedAt ? new Date(legacy.requestedAt) : new Date(),
    effectiveAt: legacy.effectiveAt ? new Date(legacy.effectiveAt) : null,
    appliedAt: legacy.appliedAt ? new Date(legacy.appliedAt) : null,
    failedAt: legacy.failedAt ? new Date(legacy.failedAt) : null,
    autopayConfigTxHash: legacy.autopayConfigTxHash,
    accessChangeTxHash: legacy.accessChangeTxHash,
    paymentTxHash: legacy.paymentTxHash,
    autopayControlTxHash: legacy.autopayControlTxHash,
    pendingVerification: legacy.pendingVerification,
    failureReason: legacy.failureReason,
    metadata: {
      ...legacy.metadata,
      legacyMaterializedAt: new Date().toISOString(),
      legacyMaterializedFromTraits: true,
      legacyMaterializedMode: legacy.mode,
    },
  };
}

function isOpenLegacyStage(
  stage: SubscriptionLifecycleStage | null | undefined,
): boolean {
  return (
    stage === "requested" ||
    stage === "pending_verification" ||
    stage === "pending_recovery"
  );
}

export async function countLegacySubscriptionTransitions(input: {
  teamId: string;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const companies = await client.arcenCompany.findMany({
    where: { teamId: input.teamId },
    select: { traits: true },
  });

  let total = 0;
  let open = 0;
  for (const company of companies) {
    const legacy = legacyTransitionToRequest({
      teamId: input.teamId,
      companyId: "",
      traits: company.traits,
    });
    if (!legacy) continue;
    total += 1;
    if (isOpenLegacyStage(legacy.stage)) open += 1;
  }

  return { total, open };
}

export async function migrateLegacySubscriptionChangeRequests(input: {
  teamId: string;
  limit?: number;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const companies = await client.arcenCompany.findMany({
    where: { teamId: input.teamId },
    orderBy: { createdAt: "asc" },
    take: input.limit,
    select: {
      id: true,
      teamId: true,
      environmentId: true,
      traits: true,
      subscriptionState: { select: { id: true } },
    },
  });

  let scanned = 0;
  let created = 0;
  let cleaned = 0;
  const results: Array<{
    companyId: string;
    action: "created_request" | "cleaned_traits" | "skipped";
    requestId?: string | null;
    reason?: string;
  }> = [];

  for (const company of companies) {
    scanned += 1;
    const currentTraits = asRecord(company.traits);
    const legacy = legacyTransitionToRequest({
      teamId: company.teamId,
      environmentId: company.environmentId ?? null,
      companyId: company.id,
      subscriptionStateId: company.subscriptionState?.id ?? null,
      traits: company.traits,
    });
    const hadLegacyFields =
      Object.keys(asRecord(currentTraits.subscriptionTransition)).length > 0 ||
      typeof currentTraits.pendingSubscriptionChangeRequestId === "string";

    let requestId: string | null = null;
    if (legacy) {
      const existing = await client.subscriptionChangeRequest.findFirst({
        where: {
          teamId: company.teamId,
          companyId: company.id,
          changeType: toDbChangeType(legacy.changeType),
          stage: toDbStage(legacy.stage),
          ...(legacy.targetPlanId ? { targetPlanId: legacy.targetPlanId } : {}),
        },
        orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
      });

      if (existing) {
        requestId = existing.id;
      } else {
        const createInput = legacyTransitionToCreateInput({
          teamId: company.teamId,
          environmentId: company.environmentId ?? null,
          companyId: company.id,
          subscriptionStateId: company.subscriptionState?.id ?? null,
          traits: company.traits,
        });
        if (createInput) {
          const createdRequest = await createSubscriptionChangeRequest(
            createInput,
            client,
          );
          requestId = createdRequest.id;
          created += 1;
          results.push({
            companyId: company.id,
            action: "created_request",
            requestId,
          });
        }
      }
    }

    if (hadLegacyFields) {
      const nextTraits = { ...currentTraits };
      delete nextTraits.subscriptionTransition;
      delete nextTraits.pendingSubscriptionChangeRequestId;
      await client.arcenCompany.update({
        where: { id: company.id },
        data: { traits: toPrismaJson(nextTraits) },
      });
      cleaned += 1;
      results.push({
        companyId: company.id,
        action: "cleaned_traits",
        requestId,
      });
    } else if (!legacy) {
      results.push({
        companyId: company.id,
        action: "skipped",
        reason: "no_legacy_transition",
      });
    }
  }

  return {
    scanned,
    created,
    cleaned,
    results,
  };
}

export async function getLatestSubscriptionChangeRequest(input: {
  teamId: string;
  companyId: string;
  includeCompleted?: boolean;
  client?: DbClient;
}): Promise<SerializedSubscriptionChangeRequest | null> {
  const client = input.client ?? db;
  const request = await client.subscriptionChangeRequest.findFirst({
    where: {
      teamId: input.teamId,
      companyId: input.companyId,
      ...(input.includeCompleted
        ? {}
        : {
            stage: {
              in: [
                "REQUESTED",
                "PENDING_VERIFICATION",
                "PENDING_RECOVERY",
              ] as const,
            },
          }),
    },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
  });

  if (request) {
    return serializeSubscriptionChangeRequest(request);
  }
  return null;
}

export async function createSubscriptionChangeRequest(
  input: SubscriptionChangeCreateInput,
  client: DbClient = db,
) {
  return client.subscriptionChangeRequest.create({
    data: {
      teamId: input.teamId,
      environmentId: input.environmentId ?? null,
      companyId: input.companyId,
      subscriptionStateId: input.subscriptionStateId ?? null,
      changeType: toDbChangeType(input.changeType),
      stage: toDbStage(input.stage ?? "requested"),
      source: toDbSource(input.source ?? "self_service"),
      previousPlanId: input.previousPlanId ?? null,
      targetPlanId: input.targetPlanId ?? null,
      previousBillingPeriod: input.previousBillingPeriod ?? null,
      targetBillingPeriod: input.targetBillingPeriod ?? null,
      requestedAt: input.requestedAt ?? new Date(),
      effectiveAt: input.effectiveAt ?? null,
      appliedAt: input.appliedAt ?? null,
      failedAt: input.failedAt ?? null,
      autopayConfigTxHash: input.autopayConfigTxHash ?? null,
      accessChangeTxHash: input.accessChangeTxHash ?? null,
      paymentTxHash: input.paymentTxHash ?? null,
      autopayControlTxHash: input.autopayControlTxHash ?? null,
      recoveryTaskId: input.recoveryTaskId ?? null,
      pendingVerification: input.pendingVerification ?? false,
      failureReason: input.failureReason ?? null,
      metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
    },
  });
}

export async function updateSubscriptionChangeRequestStage(input: {
  requestId: string;
  stage: SubscriptionLifecycleStage;
  effectiveAt?: Date | null;
  appliedAt?: Date | null;
  failedAt?: Date | null;
  recoveryTaskId?: string | null;
  pendingVerification?: boolean;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}, client: DbClient = db) {
  const existing = await client.subscriptionChangeRequest.findUnique({
    where: { id: input.requestId },
    select: { metadata: true },
  });
  const nextMetadata = {
    ...asRecord(existing?.metadata),
    ...(input.metadata ?? {}),
  };

  return client.subscriptionChangeRequest.update({
    where: { id: input.requestId },
    data: {
      stage: toDbStage(input.stage),
      ...(input.effectiveAt !== undefined ? { effectiveAt: input.effectiveAt } : {}),
      ...(input.appliedAt !== undefined ? { appliedAt: input.appliedAt } : {}),
      ...(input.failedAt !== undefined ? { failedAt: input.failedAt } : {}),
      ...(input.recoveryTaskId !== undefined
        ? { recoveryTaskId: input.recoveryTaskId }
        : {}),
      ...(input.pendingVerification !== undefined
        ? { pendingVerification: input.pendingVerification }
        : {}),
      ...(input.failureReason !== undefined
        ? { failureReason: input.failureReason }
        : {}),
      ...(Object.keys(nextMetadata).length > 0
        ? { metadata: toPrismaJson(nextMetadata) }
        : {}),
    },
  });
}

export async function revertOpenSubscriptionChangeRequests(input: {
  teamId: string;
  companyId: string;
  excludeRequestIds?: string[];
  appliedAt?: Date;
  metadata?: Record<string, unknown>;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  const requestIdsToExclude = (input.excludeRequestIds ?? []).filter(Boolean);
  const openRequests = await client.subscriptionChangeRequest.findMany({
    where: {
      teamId: input.teamId,
      companyId: input.companyId,
      stage: {
        in: ["REQUESTED", "PENDING_VERIFICATION", "PENDING_RECOVERY"] as const,
      },
      ...(requestIdsToExclude.length > 0
        ? {
            id: {
              notIn: requestIdsToExclude,
            },
          }
        : {}),
    },
    select: { id: true },
  });

  if (openRequests.length === 0) {
    return 0;
  }

  const appliedAt = input.appliedAt ?? new Date();
  for (const request of openRequests) {
    await updateSubscriptionChangeRequestStage(
      {
        requestId: request.id,
        stage: "reverted",
        appliedAt,
        pendingVerification: false,
        failureReason: null,
        metadata: input.metadata,
      },
      client,
    );
  }

  return openRequests.length;
}

export async function findSimilarOpenSubscriptionChangeRequest(input: {
  teamId: string;
  companyId: string;
  changeType: SubscriptionLifecycleChangeType;
  targetPlanId?: string | null;
  client?: DbClient;
}) {
  const client = input.client ?? db;
  return client.subscriptionChangeRequest.findFirst({
    where: {
      teamId: input.teamId,
      companyId: input.companyId,
      changeType: toDbChangeType(input.changeType),
      stage: {
        in: ["REQUESTED", "PENDING_VERIFICATION", "PENDING_RECOVERY"] as const,
      },
      ...(input.targetPlanId !== undefined
        ? { targetPlanId: input.targetPlanId }
        : {}),
    },
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
  });
}
