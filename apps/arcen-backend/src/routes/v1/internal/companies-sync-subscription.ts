import type { Context } from "hono";
import { db } from "../../../db.js";
import { z } from "zod";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import { resolvePublishedFreePlan } from "../../../lib/catalog/catalog-billing.js";
import { upsertSubscriptionLedgerState } from "../../../lib/billing/billing-ledger.js";
import { getLatestSubscriptionChangeRequest } from "../../../lib/billing/subscription-change-requests.js";
import {
  YEARLY_INTERVAL,
  isValidAddressForChain,
  normalizeWalletForChain,
} from "@arcenpay/internal-core";
import { normalizeTxHashForFamily } from "../../../lib/payments/onchain-payment-verification.js";

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
  if (normalized === "quarterly" || normalized === "quarter") return "monthly";
  if (normalized === "semi_annual" || normalized === "semi-annual" || normalized === "biannual") return "monthly";
  if (normalized === "monthly" || normalized === "month") return "monthly";
  return null;
}

function deriveBillingPeriodFromInterval(
  billingInterval: unknown,
): "monthly" | "annual" {
  if (typeof billingInterval !== "number") return "monthly";
  // Seconds thresholds: 30 days (monthly), 365 days (annual)
  // Everything between is treated as monthly; custom intervals default to monthly
  return billingInterval >= YEARLY_INTERVAL ? "annual" : "monthly";
}

const bodySchema = z.object({
  teamId: z.string().min(1),
  // Wallet must be a valid address for the given chain family — EVM 0x… hex
  // (lowercased canonically) or Stellar G…/C… base32 (case preserved).
  wallet: z.string().min(1),
  onChainPlanId: z.string().nullable(),
  event: z.enum(["minted", "renewed", "plan_changed", "cancelled"]),
  occurredAt: z.coerce.date().optional(),
  sourceTxHash: z.string().optional(),
  sourceTokenId: z.string().optional(),
  // Which chain this sync is for. EVM ids (84532 etc.) resolve to chainFamily
  // EVM; Stellar synthetic ids (9_000_000+) resolve to STELLAR. When omitted,
  // the existing rows' chainId is preserved (see resolveSyncChainId).
  chainId: z.number().int().optional(),
}).superRefine((value, ctx) => {
  if (value.event !== "cancelled" && !value.onChainPlanId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["onChainPlanId"],
      message: "onChainPlanId is required for minted, renewed, and plan_changed events.",
    });
  }
  if (value.wallet && value.chainId !== undefined) {
    if (!isValidAddressForChain(value.wallet, value.chainId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["wallet"],
        message: `wallet is not a valid address for chainId ${value.chainId}.`,
      });
    }
  }
});

export async function syncSubscription(c: Context) {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400 as any);
  }
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
    chainId,
  } = parsed.data;

  // Normalize the wallet family-aware. When chainId is present, Stellar
  // G…/C… addresses are preserved exactly (base32 is case-sensitive) while
  // EVM addresses are lowercased canonically. Without chainId we fall back to
  // EVM lowercasing to match legacy sync behavior.
  const syncChainId = chainId;
  const normalizedWallet =
    normalizeWalletForChain(wallet, syncChainId ?? 84532) ?? wallet;
  // Normalize a Stellar/odd-prefixed tx hash to the family's canonical form.
  const normalizedTxHash =
    sourceTxHash && syncChainId !== undefined
      ? (normalizeTxHashForFamily(sourceTxHash, syncChainId) ?? sourceTxHash)
      : sourceTxHash;

  const resolvedPlan =
    event === "cancelled"
      ? null
      : await db.catalogPlan.findFirst({
          where: {
            onChainPlanId,
            teamId,
            // Scope to the sync chain when provided so the same on-chain plan
            // id on two families cannot cross-match.
            ...(syncChainId !== undefined ? { chainId: syncChainId } : {}),
          },
          select: {
            id: true,
            billingInterval: true,
            environmentId: true,
            chainId: true,
          },
        });

  if (event !== "cancelled" && !resolvedPlan) {
    console.warn(
      `[SyncSubscription] No CatalogPlan found for onChainPlanId=${onChainPlanId} teamId=${teamId}`,
    );
    return c.json(
      { ok: false, error: "Plan not found for onChainPlanId" },
      404 as any,
    );
  }

  const companySelect = {
    id: true,
    teamId: true,
    environmentId: true,
    traits: true,
    activePlanId: true,
    subscriptionState: {
      select: {
        id: true,
        walletAddress: true,
        onChainTokenId: true,
        chainId: true,
      },
    },
  } as const;

  const environmentScopedWhere =
    resolvedPlan?.environmentId
      ? { environmentId: resolvedPlan.environmentId }
      : {};

  const company =
    (sourceTokenId
      ? await db.arcenCompany.findFirst({
          where: {
            teamId,
            ...environmentScopedWhere,
            subscriptionState: {
              is: { onChainTokenId: sourceTokenId },
            },
          },
          select: companySelect,
        })
      : null) ??
    (await db.arcenCompany.findFirst({
      where: {
        teamId,
        ...environmentScopedWhere,
        OR: [
          {
            subscriptionState: {
              is: {
                walletAddress: { in: [normalizedWallet, wallet] },
              },
            },
          },
          {
            walletAddress: { in: [normalizedWallet, wallet] },
          },
        ],
      },
      select: companySelect,
    }));

  if (!company) {
    return c.json({ error: "Company not found for wallet" }, 404 as any);
  }

  // Resolve the authoritative chainId for ledger writes: request chainId →
  // plan chainId → existing subscription state chainId.
  const effectiveChainId =
    syncChainId ??
    resolvedPlan?.chainId ??
    company.subscriptionState?.chainId ??
    undefined;

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
    }, 208 as any);
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
    }, 208 as any);
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
    const transitionTargetPlanId =
      typeof latestChangeRequest?.targetPlanId === "string"
        ? latestChangeRequest.targetPlanId
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

    await db.$transaction(async (tx) => {
      await tx.arcenCompany.update({
        where: { id: company.id },
        data: {
          activePlanId: resolvedPlanId,
          traits: toPrismaJson(nextTraits),
        },
      });

      await upsertSubscriptionLedgerState({
        teamId: company.teamId,
        companyId: company.id,
        walletAddress: normalizedWallet,
        status: "CANCELLED",
        catalogPlanId: resolvedPlanId,
        onChainPlanId: null,
        onChainTokenId: sourceTokenId ?? null,
        ...(effectiveChainId !== undefined ? { chainId: effectiveChainId } : {}),
        cancelAtPeriodEnd: false,
        cancelledAt: occurredAt ?? new Date(),
        lastEvent: "subscription.cancelled",
        lastEventAt: occurredAt ?? new Date(),
        lastSourceTxHash: normalizedTxHash ?? null,
        metadata: {
          source: "sync-subscription",
        },
      }, tx);

      if (latestChangeRequest?.id) {
        await tx.subscriptionChangeRequest.update({
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
    });

    return c.json({
      ok: true,
      activePlanId: resolvedPlanId,
      transitionResolved: true,
    });
  }

  const plan = resolvedPlan;
  if (!plan) {
    return c.json(
      { ok: false, error: "Plan not found for onChainPlanId" },
      404 as any,
    );
  }

  const latestChangeRequest = await getLatestSubscriptionChangeRequest({
    teamId: company.teamId,
    companyId: company.id,
  });
  const nextTraits = { ...traits };
  nextTraits.billingPeriod =
    normalizeBillingPeriod(
      latestChangeRequest?.targetBillingPeriod,
    ) ?? deriveBillingPeriodFromInterval(plan.billingInterval);
  nextTraits.subscriptionSyncMeta = nextSyncMeta;

  const eventOccurredAt = occurredAt ?? new Date();
  const isPeriodBoundaryEvent = event === "minted" || event === "renewed";
  const nextPeriodStart = isPeriodBoundaryEvent
    ? eventOccurredAt
    : undefined;
  const nextPeriodEnd = isPeriodBoundaryEvent && plan.billingInterval
    ? new Date(eventOccurredAt.getTime() + plan.billingInterval * 1000)
    : undefined;

  await db.$transaction(async (tx) => {
    await tx.arcenCompany.update({
      where: { id: company.id },
      data: {
        activePlanId: plan.id,
        traits: toPrismaJson(nextTraits),
      },
    });

    await upsertSubscriptionLedgerState({
      teamId: company.teamId,
      companyId: company.id,
      walletAddress: normalizedWallet,
      status: "ACTIVE",
      catalogPlanId: plan.id,
      onChainPlanId,
      onChainTokenId: sourceTokenId ?? null,
      // The plan owns the authoritative chain; fall back to the sync request's
      // chainId or the existing subscription state when the plan predates
      // chain scoping.
      chainId: effectiveChainId,
      ...(nextPeriodStart ? { currentPeriodStart: nextPeriodStart } : {}),
      ...(nextPeriodEnd ? { currentPeriodEnd: nextPeriodEnd } : {}),
      cancelAtPeriodEnd: isPeriodBoundaryEvent ? false : undefined,
      cancelledAt: isPeriodBoundaryEvent ? null : undefined,
      pastDueAt: null,
      graceEndsAt: null,
      lastEvent:
        event === "minted"
          ? "subscription.minted"
          : event === "renewed"
            ? "subscription.renewed"
            : "subscription.plan_changed",
      lastEventAt: eventOccurredAt,
      lastSourceTxHash: normalizedTxHash ?? null,
      metadata: {
        source: "sync-subscription",
      },
    }, tx);

    if (latestChangeRequest?.id) {
      await tx.subscriptionChangeRequest.update({
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
  });

  return c.json({ ok: true, activePlanId: plan.id });
}
