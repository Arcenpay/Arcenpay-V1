import type { Context } from "hono";
import { db } from "../../../db.js";
import { z } from "zod";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import { requireFacilitatorAuth } from "../../../lib/auth/facilitator-auth.js";
import { resolvePublishedFreePlan } from "../../../lib/catalog/catalog-billing.js";
import { upsertSubscriptionLedgerState } from "../../../lib/billing/billing-ledger.js";
import { getLatestSubscriptionChangeRequest } from "../../../lib/billing/subscription-change-requests.js";

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

const bodySchema = z.object({
  teamId: z.string().min(1),
  wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/i),
  onChainPlanId: z.string().nullable(),
  event: z.enum(["minted", "renewed", "plan_changed", "cancelled"]),
  occurredAt: z.coerce.date().optional(),
  sourceTxHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/i)
    .optional(),
  sourceTokenId: z.string().optional(),
}).superRefine((value, ctx) => {
  if (value.event !== "cancelled" && !value.onChainPlanId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["onChainPlanId"],
      message: "onChainPlanId is required for minted, renewed, and plan_changed events.",
    });
  }
});

export async function syncSubscription(c: Context) {
  const authError = requireFacilitatorAuth(c.req.raw.headers);
  if (authError) return c.json({ error: authError.error }, authError.status as any as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const {
    teamId,
    wallet,
    onChainPlanId,
    event,
    occurredAt,
    sourceTxHash,
    sourceTokenId,
  } = parsed.data;

  const company = await db.arcenCompany.findFirst({
    where: {
      walletAddress: wallet.toLowerCase(),
      teamId,
    },
    select: { id: true, teamId: true, traits: true, activePlanId: true },
  });

  if (!company) {
    return c.json({ error: "Company not found for wallet" }, 404 as any);
  }

  const traits = asRecord(company.traits);
  const syncMeta = asRecord(traits.subscriptionSyncMeta);
  const previousOccurredAtRaw =
    typeof syncMeta.occurredAt === "string" ? syncMeta.occurredAt : null;
  const previousOccurredAtMs = previousOccurredAtRaw
    ? Date.parse(previousOccurredAtRaw)
    : NaN;

  if (
    occurredAt &&
    Number.isFinite(previousOccurredAtMs) &&
    previousOccurredAtMs > occurredAt.getTime()
  ) {
    return c.json({
      ok: true,
      skipped: true,
      reason: "stale_event",
      activePlanId: company.activePlanId,
    });
  }

  if (
    sourceTxHash &&
    typeof syncMeta.sourceTxHash === "string" &&
    syncMeta.sourceTxHash.toLowerCase() === sourceTxHash.toLowerCase() &&
    typeof syncMeta.event === "string" &&
    syncMeta.event === event
  ) {
    return c.json({
      ok: true,
      skipped: true,
      reason: "duplicate_event",
      activePlanId: company.activePlanId,
    });
  }

  const nextSyncMeta: Record<string, unknown> = {
    event,
    occurredAt: occurredAt?.toISOString() ?? new Date().toISOString(),
    sourceTxHash: sourceTxHash ?? null,
    sourceTokenId: sourceTokenId ?? null,
    updatedAt: new Date().toISOString(),
  };

  if (event === "cancelled") {
    const latestChangeRequest = await getLatestSubscriptionChangeRequest({
      teamId: company.teamId,
      companyId: company.id,
    });
    const transition = asRecord(traits.subscriptionTransition);
    const transitionTargetPlanId =
      typeof transition.targetPlanId === "string"
        ? transition.targetPlanId
        : null;

    let resolvedPlanId: string | null = null;
    if (transitionTargetPlanId) {
      const targetPlan = await db.catalogPlan.findFirst({
        where: {
          id: transitionTargetPlanId,
          teamId: company.teamId,
          status: "PUBLISHED",
          active: true,
        },
        select: { id: true },
      });
      resolvedPlanId = targetPlan?.id ?? null;
    }

    if (!resolvedPlanId) {
      const fallbackPlan = await resolvePublishedFreePlan(company.teamId);
      resolvedPlanId = fallbackPlan?.id ?? null;
    }

    if (!resolvedPlanId) {
      return c.json({
          ok: false,
          error:
            "No published free plan is configured for cancellation fallback.",
        }, 409 as any);
    }

    const nextTraits = { ...traits };
    delete nextTraits.subscriptionTransition;
    delete nextTraits.billingPeriod;
    nextTraits.subscriptionSyncMeta = nextSyncMeta;

    await db.arcenCompany.update({
      where: { id: company.id },
      data: {
        activePlanId: resolvedPlanId,
        traits: toPrismaJson(nextTraits),
      },
    });

    await upsertSubscriptionLedgerState({
      teamId: company.teamId,
      companyId: company.id,
      walletAddress: wallet,
      status: "CANCELLED",
      catalogPlanId: resolvedPlanId,
      onChainPlanId: null,
      onChainTokenId: sourceTokenId ?? null,
      cancelAtPeriodEnd: false,
      cancelledAt: occurredAt ?? new Date(),
      lastEvent: "subscription.cancelled",
      lastEventAt: occurredAt ?? new Date(),
      lastSourceTxHash: sourceTxHash ?? null,
      metadata: {
        source: "sync-subscription",
      },
    });

    if (latestChangeRequest?.id && !latestChangeRequest.id.startsWith("legacy-")) {
      await db.subscriptionChangeRequest.update({
        where: { id: latestChangeRequest.id },
        data: {
          stage: "APPLIED",
          appliedAt: occurredAt ?? new Date(),
          effectiveAt: occurredAt ?? new Date(),
          pendingVerification: false,
          failureReason: null,
        },
      });
    }

    return c.json({
      ok: true,
      activePlanId: resolvedPlanId,
      transitionResolved: true,
    });
  }

  const plan = await db.catalogPlan.findFirst({
    where: { onChainPlanId, teamId: company.teamId },
    select: { id: true, billingInterval: true },
  });

  if (!plan) {
    console.warn(
      `[SyncSubscription] No CatalogPlan found for onChainPlanId=${onChainPlanId} teamId=${company.teamId}`,
    );
    return c.json({ ok: false, error: "Plan not found for onChainPlanId" }, 404 as any);
  }

  const nextTraits = { ...traits };
  delete nextTraits.subscriptionTransition;
  nextTraits.billingPeriod =
    normalizeBillingPeriod(
      asRecord(traits.subscriptionTransition).targetBillingPeriod,
    ) ?? deriveBillingPeriodFromInterval(plan.billingInterval);
  nextTraits.subscriptionSyncMeta = nextSyncMeta;

  await db.arcenCompany.update({
    where: { id: company.id },
    data: {
      activePlanId: plan.id,
      traits: toPrismaJson(nextTraits),
    },
  });

  await upsertSubscriptionLedgerState({
    teamId: company.teamId,
    companyId: company.id,
    walletAddress: wallet,
    status: "ACTIVE",
    catalogPlanId: plan.id,
    onChainPlanId,
    onChainTokenId: sourceTokenId ?? null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueAt: null,
    graceEndsAt: null,
    lastEvent:
      event === "minted"
        ? "subscription.minted"
        : event === "renewed"
          ? "subscription.renewed"
          : "subscription.plan_changed",
    lastEventAt: occurredAt ?? new Date(),
    lastSourceTxHash: sourceTxHash ?? null,
    metadata: {
      source: "sync-subscription",
    },
  });

  const latestChangeRequest = await getLatestSubscriptionChangeRequest({
    teamId: company.teamId,
    companyId: company.id,
  });
  if (latestChangeRequest?.id && !latestChangeRequest.id.startsWith("legacy-")) {
    await db.subscriptionChangeRequest.update({
      where: { id: latestChangeRequest.id },
      data: {
        stage: "APPLIED",
        appliedAt: occurredAt ?? new Date(),
        effectiveAt: occurredAt ?? new Date(),
        pendingVerification: false,
        failureReason: null,
      },
    });
  }

  return c.json({ ok: true, activePlanId: plan.id });
}
