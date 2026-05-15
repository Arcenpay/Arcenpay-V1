import { db } from "../../db.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { resolvePublishedFreePlan } from "../catalog/catalog-billing.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

export function shouldEnforceDunning(input: {
  status: "ACTIVE" | "PAST_DUE" | "CANCELLED";
  graceEndsAt?: Date | null;
  now?: Date;
}): boolean {
  if (input.status !== "PAST_DUE") return false;
  if (!input.graceEndsAt) return false;
  const now = input.now ?? new Date();
  return input.graceEndsAt.getTime() <= now.getTime();
}

export async function runBillingDunningSweep(options?: {
  now?: Date;
  teamId?: string;
  limit?: number;
}) {
  const now = options?.now ?? new Date();
  const candidates = await db.subscriptionState.findMany({
    where: {
      ...(options?.teamId ? { teamId: options.teamId } : {}),
      status: "PAST_DUE",
      graceEndsAt: { lte: now },
    },
    orderBy: { graceEndsAt: "asc" },
    take: options?.limit ?? 100,
    include: {
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
    subscriptionStateId: string;
    companyId: string;
    teamId: string;
    action: "downgraded_to_free" | "skipped_missing_free_plan";
    planId: string | null;
  }> = [];

  for (const state of candidates) {
    const freePlan = await resolvePublishedFreePlan(state.teamId);
    if (!freePlan) {
      results.push({
        subscriptionStateId: state.id,
        companyId: state.companyId,
        teamId: state.teamId,
        action: "skipped_missing_free_plan",
        planId: null,
      });
      continue;
    }

    const currentTraits =
      state.company?.traits &&
      typeof state.company.traits === "object" &&
      !Array.isArray(state.company.traits)
        ? (state.company.traits as Record<string, unknown>)
        : {};

    await db.$transaction([
      db.arcenCompany.update({
        where: { id: state.companyId },
        data: {
          activePlanId: freePlan.id,
          traits: toPrismaJson({
            ...currentTraits,
            billingEnforcement: {
              reason: "dunning_grace_expired",
              enforcedAt: now.toISOString(),
              previousPlanId: state.company.activePlanId,
              fallbackPlanId: freePlan.id,
            },
          }),
        },
      }),
      db.subscriptionState.update({
        where: { id: state.id },
        data: {
          status: "CANCELLED",
          catalogPlanId: freePlan.id,
          cancelAtPeriodEnd: false,
          cancelledAt: now,
          lastEvent: "subscription.dunning_enforced",
          lastEventAt: now,
        },
      }),
    ]);

    deliverWebhook(state.teamId, "company.plan.changed", {
      companyId: state.companyId,
      previousPlanId: state.company.activePlanId,
      planId: freePlan.id,
      mode: "dunning_enforced",
      reason: "grace_expired",
      effectiveAt: now.toISOString(),
    }).catch((err) => {
      console.warn("[billing-dunning] Failed to deliver webhook:", err);
    });

    results.push({
      subscriptionStateId: state.id,
      companyId: state.companyId,
      teamId: state.teamId,
      action: "downgraded_to_free",
      planId: freePlan.id,
    });
  }

  return {
    scanned: candidates.length,
    enforced: results.filter((item) => item.action === "downgraded_to_free")
      .length,
    skipped: results.filter(
      (item) => item.action === "skipped_missing_free_plan",
    ).length,
    results,
  };
}
