/**
 * PATCH /api/internal/companies/sync-subscription
 *
 * Called by the facilitator when a subscription event is detected on-chain.
 * Updates company.activePlanId based on the event type.
 *
 * Auth: Authorization: Bearer <FACILITATOR_SECRET>
 *
 * Body:
 *   wallet        — subscriber wallet address
 *   onChainPlanId — the planId from PlanFactory.sol (null for cancellation)
 *   event         — 'minted' | 'renewed' | 'plan_changed' | 'cancelled'
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import { toPrismaJson } from "@/lib/prisma-json";
import { requireFacilitatorAuth } from "@/lib/facilitator-auth";
import { resolvePublishedFreePlan } from "@/lib/catalog-billing";
import { upsertSubscriptionLedgerState } from "@/lib/billing-ledger";

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

export async function PATCH(req: NextRequest) {
  const authError = requireFacilitatorAuth(req);
  if (authError) return authError;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: "Company not found for wallet" },
      { status: 404 },
    );
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
    return NextResponse.json({
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
    return NextResponse.json({
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
      return NextResponse.json(
        {
          ok: false,
          error:
            "No published free plan is configured for cancellation fallback.",
        },
        { status: 409 },
      );
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

    return NextResponse.json({
      ok: true,
      activePlanId: resolvedPlanId,
      transitionResolved: true,
    });
  }

  // minted | renewed | plan_changed — resolve the on-chain plan to our internal plan
  const plan = await db.catalogPlan.findFirst({
    where: { onChainPlanId, teamId: company.teamId },
    select: { id: true, billingInterval: true },
  });

  if (!plan) {
    console.warn(
      `[SyncSubscription] No CatalogPlan found for onChainPlanId=${onChainPlanId} teamId=${company.teamId}`,
    );
    return NextResponse.json(
      { ok: false, error: "Plan not found for onChainPlanId" },
      { status: 404 },
    );
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

  return NextResponse.json({ ok: true, activePlanId: plan.id });
}
