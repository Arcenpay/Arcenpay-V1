import { getBillingReconciliationSummary } from "./billing-reconciliation.js";
import { runBillingDunningSweep } from "./billing-dunning.js";
import { processPendingBillingRecoveryTasks } from "./billing-recovery.js";
import { db } from "../../db.js";
import { resolvePublishedFreePlan } from "../catalog/catalog-billing.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { recordBillingAdjustment } from "./billing-adjustments.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { computeProrationQuote } from "./billing-proration.js";
import { getLatestSubscriptionChangeRequest } from "./subscription-change-requests.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeBillingPeriod(
  value: unknown,
): "monthly" | "annual" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") return "annual";
  if (normalized === "monthly" || normalized === "month") return "monthly";
  return null;
}

function deriveBillingPeriodFromInterval(
  billingInterval: unknown,
): "monthly" | "annual" {
  return typeof billingInterval === "number" && billingInterval >= 31_536_000
    ? "annual"
    : "monthly";
}

function priceToNumber(price: unknown): number {
  if (price === null || price === undefined) return 0;
  const numeric = Number(price);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolvePlanAmountMicros(
  plan: { price: unknown; annualPrice?: unknown },
  billingPeriod: "monthly" | "annual",
): number {
  const annualMicros = Math.round(priceToNumber(plan.annualPrice) * 1_000_000);
  if (billingPeriod === "annual" && annualMicros > 0) {
    return annualMicros;
  }
  return Math.round(priceToNumber(plan.price) * 1_000_000);
}

function microsToAmount(value: number): number {
  return value / 1_000_000;
}

function readTransitionMetadata(
  transition: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!transition) return {};
  const metadata = asRecord(transition.metadata);
  return Object.keys(metadata).length > 0 ? metadata : transition;
}

export async function applyScheduledSubscriptionTransitions(input: {
  teamId: string;
  limit?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const states = await db.subscriptionState.findMany({
    where: {
      teamId: input.teamId,
      currentPeriodEnd: { lte: now },
      OR: [
        { cancelAtPeriodEnd: true },
        { currentPeriodEnd: { lte: now } },
      ],
    },
    orderBy: { currentPeriodEnd: "asc" },
    take: input.limit ?? 100,
    select: {
      id: true,
      companyId: true,
      walletAddress: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      onChainTokenId: true,
      cancelAtPeriodEnd: true,
      company: {
        select: {
          id: true,
          environmentId: true,
          activePlanId: true,
          traits: true,
        },
      },
    },
  });

  const results: Array<{
    companyId: string;
    action: "downgrade_applied" | "cancel_applied" | "stale_next_renewal" | "skipped";
    targetPlanId?: string | null;
    reason?: string;
  }> = [];

  for (const state of states) {
    const traits = asRecord(state.company.traits);
    const changeRequest = await getLatestSubscriptionChangeRequest({
      teamId: input.teamId,
      companyId: state.companyId,
    });
    const transition = changeRequest ?? asRecord(traits.subscriptionTransition);
    const transitionMetadata = readTransitionMetadata(
      transition as Record<string, unknown>,
    );
    const mode = typeof transition.mode === "string" ? transition.mode : null;
    const pendingVerification = Boolean(
      (transition as Record<string, unknown>).pendingVerification ??
        transitionMetadata.pendingVerification,
    );

    if (pendingVerification) {
      results.push({
        companyId: state.companyId,
        action: "skipped",
        reason: "pending_verification",
      });
      continue;
    }

    if (mode === "next_renewal_on_chain") {
      const transitionRequestedAtRaw =
        typeof transition.requestedAt === "string"
          ? transition.requestedAt
          : null;
      const requestedAt = transitionRequestedAtRaw
        ? new Date(transitionRequestedAtRaw)
        : null;
      const stalenessHours = requestedAt
        ? (now.getTime() - requestedAt.getTime()) / (1000 * 60 * 60)
        : 0;

      const nextTraits = { ...traits };
      delete nextTraits.subscriptionTransition;

      await db.arcenCompany.update({
        where: { id: state.companyId },
        data: { traits: toPrismaJson(nextTraits) },
      });

      if (changeRequest?.id && !changeRequest.id.startsWith("legacy-")) {
        await db.subscriptionChangeRequest.update({
          where: { id: changeRequest.id },
          data: {
            stage: "FAILED",
            failedAt: now,
            failureReason: `on_chain_renewal_not_detected_staleness_hours:${Math.round(stalenessHours)}`,
          },
        });
      }

      results.push({
        companyId: state.companyId,
        action: "stale_next_renewal",
        reason: `on_chain_renewal_not_detected_staleness_hours:${Math.round(stalenessHours)}`,
        targetPlanId: state.company.activePlanId,
      });
      continue;
    }

    if (mode !== "period_end_downgrade" && mode !== "cancel_at_period_end") {
      results.push({
        companyId: state.companyId,
        action: "skipped",
        reason: "no_due_transition",
      });
      continue;
    }

    let targetPlanId =
      typeof transition.targetPlanId === "string"
        ? transition.targetPlanId
        : null;
    if (mode === "cancel_at_period_end" && !targetPlanId) {
      const freePlan = await resolvePublishedFreePlan(input.teamId);
      targetPlanId = freePlan?.id ?? null;
    }

    if (!targetPlanId) {
      results.push({
        companyId: state.companyId,
        action: "skipped",
        reason: "missing_target_plan",
      });
      continue;
    }

    const requiresOnChainSync = Boolean(transitionMetadata.requiresOnChainSync);
    if (mode === "period_end_downgrade" && requiresOnChainSync) {
      const transitionRequestedAtRaw =
        typeof transition.requestedAt === "string"
          ? transition.requestedAt
          : null;
      const requestedAt = transitionRequestedAtRaw
        ? new Date(transitionRequestedAtRaw)
        : null;
      const stalenessHours = requestedAt
        ? (now.getTime() - requestedAt.getTime()) / (1000 * 60 * 60)
        : 0;
      if (stalenessHours < 48) {
        results.push({
          companyId: state.companyId,
          action: "skipped",
          reason: "awaiting_on_chain_sync",
          targetPlanId,
        });
        continue;
      }
    }

    const targetPlan = await db.catalogPlan.findFirst({
      where: {
        id: targetPlanId,
        teamId: input.teamId,
        status: "PUBLISHED",
        active: true,
      },
      select: { id: true, name: true, onChainPlanId: true, billingInterval: true, price: true, annualPrice: true },
    });

    if (!targetPlan) {
      results.push({
        companyId: state.companyId,
        action: "skipped",
        reason: "target_plan_not_available",
      });
      continue;
    }

    const [previousPlan, subscriptionStateForAdjustment] = await Promise.all([
      state.company.activePlanId
        ? db.catalogPlan.findFirst({
            where: { id: state.company.activePlanId, teamId: input.teamId },
            select: { id: true, name: true, price: true, annualPrice: true, billingInterval: true },
          })
        : null,
      db.subscriptionState.findUnique({
        where: { id: state.id },
        select: { id: true },
      }),
    ]);

    const targetBillingPeriod =
      normalizeBillingPeriod(transition.targetBillingPeriod) ??
      deriveBillingPeriodFromInterval(targetPlan.billingInterval);

    const currentBillingPeriod =
      normalizeBillingPeriod(
        (transition as Record<string, unknown>).previousBillingPeriod,
      ) ?? deriveBillingPeriodFromInterval(previousPlan?.billingInterval);

    const nextTraits = { ...traits };
    delete nextTraits.subscriptionTransition;
    nextTraits.billingPeriod = targetBillingPeriod;
    nextTraits.subscriptionSyncMeta = {
      event:
        mode === "cancel_at_period_end"
          ? "scheduled_cancel_applied"
          : "scheduled_downgrade_applied",
      occurredAt: now.toISOString(),
      previousPlanId: state.company.activePlanId ?? null,
      targetPlanId,
    };

    if (previousPlan && state.currentPeriodStart && state.currentPeriodEnd) {
      const currentAmountMicros = resolvePlanAmountMicros(previousPlan, currentBillingPeriod);
      const targetAmountMicros = resolvePlanAmountMicros(targetPlan, targetBillingPeriod);

      const quote = computeProrationQuote({
        currentAmountMicros: BigInt(currentAmountMicros),
        targetAmountMicros: BigInt(targetAmountMicros),
        currentPeriodStart: state.currentPeriodStart,
        currentPeriodEnd: state.currentPeriodEnd,
        effectiveAt: now,
      });

      if (quote.deltaMicros < 0n) {
        const creditAmount = microsToAmount(Number(-quote.deltaMicros));
        await recordBillingAdjustment({
          teamId: input.teamId,
          companyId: state.companyId,
          subscriptionStateId: subscriptionStateForAdjustment?.id ?? null,
          kind: "DOWNGRADE_PRORATION_CREDIT",
          amount: creditAmount,
          fromCatalogPlanId: state.company.activePlanId ?? null,
          toCatalogPlanId: targetPlan.id,
          periodStartedAt: state.currentPeriodStart,
          periodEndsAt: state.currentPeriodEnd,
          effectiveAt: now,
          postedAt: now,
          metadata: {
            source: "billing-maintenance",
            transitionMode: mode,
            currentBillingPeriod,
            targetBillingPeriod,
            remainingRatio: quote.remainingRatio,
          },
        });
      }
    }

    await db.arcenCompany.update({
      where: { id: state.companyId },
      data: {
        activePlanId: targetPlan.id,
        traits: toPrismaJson(nextTraits),
      },
    });

    await db.subscriptionState.update({
      where: { id: state.id },
      data: {
        status: mode === "cancel_at_period_end" ? "CANCELLED" : "ACTIVE",
        catalogPlanId: targetPlan.id,
        onChainPlanId:
          mode === "cancel_at_period_end" ? null : targetPlan.onChainPlanId,
        cancelAtPeriodEnd: false,
        cancelledAt: mode === "cancel_at_period_end" ? now : null,
        lastEvent:
          mode === "cancel_at_period_end"
            ? "subscription.cancelled_at_period_end"
            : "subscription.downgraded_at_period_end",
        lastEventAt: now,
        metadata: toPrismaJson({
          source: "billing-maintenance",
          previousPlanId: state.company.activePlanId ?? null,
          targetPlanId,
          transitionMode: mode,
          billingPeriod: nextTraits.billingPeriod,
        }),
      },
    });

    if (changeRequest?.id && !changeRequest.id.startsWith("legacy-")) {
      await db.subscriptionChangeRequest.update({
        where: { id: changeRequest.id },
        data: {
          stage: "APPLIED",
          appliedAt: now,
          effectiveAt: now,
          pendingVerification: false,
          failureReason: null,
        },
      });
    }

    deliverWebhook(input.teamId, "company.plan.changed", {
      companyId: state.companyId,
      environmentId: state.company.environmentId ?? null,
      transitionId: changeRequest?.id ?? null,
      changeType:
        mode === "cancel_at_period_end" ? "cancellation" : "downgrade",
      stage: "applied",
      planId: targetPlan.id,
      planName: targetPlan.name,
      billingPeriod: targetBillingPeriod,
      previousPlanId: state.company.activePlanId ?? null,
      mode:
        mode === "cancel_at_period_end"
          ? "cancellation_completed"
          : "downgrade_completed",
      scheduled: false,
      effectiveAt: now.toISOString(),
      source: "billing-maintenance",
    }).catch(() => {});

    if (mode === "cancel_at_period_end") {
      deliverWebhook(input.teamId, "company.plan.cancelled", {
        companyId: state.companyId,
        environmentId: state.company.environmentId ?? null,
        transitionId: changeRequest?.id ?? null,
        changeType: "cancellation",
        stage: "applied",
        previousPlanId: state.company.activePlanId ?? null,
        fallbackPlanId: targetPlan.id,
        mode: "cancellation_completed",
        scheduled: false,
        effectiveAt: now.toISOString(),
        source: "billing-maintenance",
      }).catch(() => {});
    }

    results.push({
      companyId: state.companyId,
      action:
        mode === "cancel_at_period_end"
          ? "cancel_applied"
          : "downgrade_applied",
      targetPlanId,
    });
  }

  return {
    scanned: states.length,
    applied: results.filter((result) => result.action !== "skipped" && result.action !== "stale_next_renewal").length,
    skipped: results.filter((result) => result.action === "skipped").length,
    staleNextRenewal: results.filter((result) => result.action === "stale_next_renewal").length,
    results,
  };
}

export async function runBillingMaintenance(input: {
  teamId: string;
  executeDunning?: boolean;
  limit?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  const reconciliationBefore = await getBillingReconciliationSummary({
    teamId: input.teamId,
    now,
  });

  const recovery = await processPendingBillingRecoveryTasks({
    teamId: input.teamId,
    now,
    limit: input.limit ?? 100,
  });

  const scheduledTransitions = await applyScheduledSubscriptionTransitions({
    teamId: input.teamId,
    now,
    limit: input.limit ?? 100,
  });

  const dunning =
    input.executeDunning
      ? await runBillingDunningSweep({
          teamId: input.teamId,
          now,
          limit: input.limit ?? 100,
        })
      : {
          scanned: 0,
          enforced: 0,
          skipped: 0,
          results: [],
          dryRun: true,
        };

  const reconciliationAfter = await getBillingReconciliationSummary({
    teamId: input.teamId,
    now,
  });

  return {
    executedAt: now.toISOString(),
    teamId: input.teamId,
    executeDunning: Boolean(input.executeDunning),
    reconciliationBefore,
    recovery,
    scheduledTransitions,
    dunning,
    reconciliationAfter,
  };
}

export async function runBillingMaintenanceForAllTeams(input?: {
  executeDunning?: boolean;
  limitPerTeam?: number;
  teamLimit?: number;
  now?: Date;
}) {
  const now = input?.now ?? new Date();
  const teams = await db.team.findMany({
    where: {
      OR: [
        { arcenCompanies: { some: {} } },
        { invoices: { some: {} } },
        { billingEvents: { some: {} } },
        { subscriptionStates: { some: {} } },
        { billingRecoveryTasks: { some: {} } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: input?.teamLimit ?? 200,
    select: { id: true, slug: true, name: true },
  });

  const results = [];
  for (const team of teams) {
    const result = await runBillingMaintenance({
      teamId: team.id,
      executeDunning: input?.executeDunning ?? false,
      limit: input?.limitPerTeam,
      now,
    });
    results.push({
      ...result,
      teamSlug: team.slug,
      teamName: team.name,
    });
  }

  return {
    executedAt: now.toISOString(),
    executeDunning: Boolean(input?.executeDunning),
    teamsProcessed: results.length,
    teams: results,
  };
}
