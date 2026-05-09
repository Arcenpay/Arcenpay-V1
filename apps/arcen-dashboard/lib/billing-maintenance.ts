import { getBillingReconciliationSummary } from "@/lib/billing-reconciliation";
import { runBillingDunningSweep } from "@/lib/billing-dunning";
import { processPendingBillingRecoveryTasks } from "@/lib/billing-recovery";
import { db } from "@/lib/db";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import { toPrismaJson } from "@/lib/prisma-json";

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
    },
    orderBy: { currentPeriodEnd: "asc" },
    take: input.limit ?? 100,
    select: {
      id: true,
      companyId: true,
      walletAddress: true,
      currentPeriodEnd: true,
      onChainTokenId: true,
      company: {
        select: {
          id: true,
          activePlanId: true,
          traits: true,
        },
      },
    },
  });

  const results: Array<{
    companyId: string;
    action: "downgrade_applied" | "cancel_applied" | "skipped";
    targetPlanId?: string | null;
    reason?: string;
  }> = [];

  for (const state of states) {
    const traits = asRecord(state.company.traits);
    const transition = asRecord(traits.subscriptionTransition);
    const mode =
      typeof transition.mode === "string" ? transition.mode : null;

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

    const targetPlan = await db.catalogPlan.findFirst({
      where: {
        id: targetPlanId,
        teamId: input.teamId,
        status: "PUBLISHED",
        active: true,
      },
      select: { id: true, onChainPlanId: true, billingInterval: true },
    });

    if (!targetPlan) {
      results.push({
        companyId: state.companyId,
        action: "skipped",
        reason: "target_plan_not_available",
      });
      continue;
    }

    const nextTraits = { ...traits };
    delete nextTraits.subscriptionTransition;
    nextTraits.billingPeriod =
      normalizeBillingPeriod(transition.targetBillingPeriod) ??
      deriveBillingPeriodFromInterval(targetPlan.billingInterval);
    nextTraits.subscriptionSyncMeta = {
      event:
        mode === "cancel_at_period_end"
          ? "scheduled_cancel_applied"
          : "scheduled_downgrade_applied",
      occurredAt: now.toISOString(),
      previousPlanId: state.company.activePlanId ?? null,
      targetPlanId,
    };

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
    applied: results.filter((result) => result.action !== "skipped").length,
    skipped: results.filter((result) => result.action === "skipped").length,
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
