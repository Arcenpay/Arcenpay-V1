import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { createPublicClient, http } from "viem";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { listAllMetadataEntitlements } from "../../../lib/catalog/catalog-entitlements.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { resolvePlanNetwork } from "../../../lib/catalog/plan-network.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { assertCanCreatePlan } from "../../../lib/catalog/tier-guard.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import { createResilientPublicClient, getRpcUrl } from "../../../config.js";
import {
  getChain,
  MONTHLY_INTERVAL,
  PlanFactoryABI,
  YEARLY_INTERVAL,
  getContractAddresses,
} from "@arcenpay/internal-core";

const listSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const QUARTERLY_INTERVAL = MONTHLY_INTERVAL * 3;
const BILLING_INTERVALS = new Set([
  MONTHLY_INTERVAL,
  QUARTERLY_INTERVAL,
  YEARLY_INTERVAL,
]);

const billingIntervalSchema = z.coerce.number().int().refine(
  (value) => BILLING_INTERVALS.has(value),
  "Billing interval must be Monthly, Quarterly, or Annual.",
);

const createSchema = z.object({
  name: z.string().min(1),
  tier: z.string().min(1),
  description: z.string().optional(),
  price: z.coerce.number().nonnegative(),
  annualPrice: z.coerce.number().nonnegative().optional(),
  billingInterval: billingIntervalSchema,
  acceptedToken: z.string().min(1),
  chainId: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  tier: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  price: z.coerce.number().nonnegative().optional(),
  annualPrice: z.coerce.number().nonnegative().nullable().optional(),
  billingInterval: billingIntervalSchema.optional(),
  acceptedToken: z.string().min(1).optional(),
  chainId: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

function normalizeComparableAddress(value: string): string {
  return value.trim().toLowerCase();
}

function resolveMaxOnChainChargeMicrosFromValues(input: {
  price: number;
  annualPrice?: number | null;
}): bigint {
  const monthlyMicros = Math.round(input.price * 1_000_000);
  const annualMicros = Math.round(Number(input.annualPrice ?? 0) * 1_000_000);
  return BigInt(Math.max(monthlyMicros, annualMicros, 0));
}

function getLockedOnChainFieldChanges(
  existing: {
    name: string;
    tier: string;
    billingInterval: number;
    acceptedToken: string;
    chainId: number;
  },
  updates: z.infer<typeof updateSchema>,
): string[] {
  const changedFields: string[] = [];

  if (updates.name !== undefined && updates.name !== existing.name) {
    changedFields.push("name");
  }
  if (updates.tier !== undefined && updates.tier !== existing.tier) {
    changedFields.push("tier");
  }
  if (
    updates.billingInterval !== undefined &&
    updates.billingInterval !== existing.billingInterval
  ) {
    changedFields.push("billing interval");
  }
  if (
    updates.acceptedToken !== undefined &&
    normalizeComparableAddress(updates.acceptedToken) !==
      normalizeComparableAddress(existing.acceptedToken)
  ) {
    changedFields.push("accepted token");
  }
  if (updates.chainId !== undefined && updates.chainId !== existing.chainId) {
    changedFields.push("network");
  }

  return changedFields;
}

const deleteSchema = z.object({
  id: z.string().min(1),
});

export async function listPlans(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid query", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const plans = await db.catalogPlan.findMany({
    where: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      ...(parsed.data.status && { status: parsed.data.status }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const repairedPlans = await Promise.all(
    plans.map(async (plan) => {
      if (plan.onChainPlanId) {
        if (parseFloat(plan.price.toString()) === 0) return plan;

        try {
          const publicClient = createResilientPublicClient(activeEnvironment.chainId);
          const contracts = getContractAddresses(activeEnvironment.chainId);
          const livePlan = (await publicClient.readContract({
            address: contracts.planFactory as `0x${string}`,
            abi: PlanFactoryABI,
            functionName: "getPlan",
            args: [BigInt(plan.onChainPlanId)],
          })) as { price?: bigint };
          const expectedPriceCap = resolveMaxOnChainChargeMicrosFromValues({
            price: parseFloat(plan.price.toString()),
            annualPrice: plan.annualPrice
              ? parseFloat(plan.annualPrice.toString())
              : 0,
          });
          const livePriceCap = BigInt(livePlan.price ?? 0n);

          if (livePriceCap === expectedPriceCap) {
            return plan;
          }

          return db.catalogPlan.update({
            where: { id: plan.id },
            data: {
              chainSyncStatus: "PENDING",
              chainSyncError:
                `On-chain price cap is ${livePriceCap.toString()} but this plan now requires ${expectedPriceCap.toString()}. Run on-chain sync to update the plan price cap.`,
              chainSyncedAt: null,
            },
          });
        } catch {
          return plan;
        }
      }

      const resolved = resolvePlanNetwork({
        environmentMode: activeEnvironment.mode,
        acceptedToken: plan.acceptedToken,
        requestedChainId: activeEnvironment.chainId,
      });
      if (!resolved) return plan;

      const chainChanged = plan.chainId !== resolved.chainId;
      const tokenChanged =
        normalizeComparableAddress(plan.acceptedToken) !==
        normalizeComparableAddress(resolved.acceptedToken);

      if (!chainChanged && !tokenChanged) return plan;

      const repaired = await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          chainId: activeEnvironment.chainId,
          acceptedToken: resolved.acceptedToken,
          chainSyncStatus:
            parseFloat(plan.price.toString()) === 0 ? "NOT_APPLICABLE" : "PENDING",
          chainSyncError: null,
          chainSyncedAt: null,
        },
      });

      return repaired;
    }),
  );

  const freePlansToFix = repairedPlans.filter(
    (p) => parseFloat(p.price.toString()) === 0 && p.chainSyncStatus !== "NOT_APPLICABLE",
  );
  if (freePlansToFix.length > 0) {
    await db.catalogPlan.updateMany({
      where: { id: { in: freePlansToFix.map((p) => p.id) } },
      data: { chainSyncStatus: "NOT_APPLICABLE" },
    });
    for (const p of freePlansToFix) {
      (p as unknown as Record<string, string>).chainSyncStatus = "NOT_APPLICABLE";
    }
  }

  return c.json({ plans: repairedPlans });
}

export async function createPlan(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const data = parsed.data;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const resolvedNetwork = resolvePlanNetwork({
    environmentMode: activeEnvironment.mode,
    acceptedToken: data.acceptedToken,
    requestedChainId: activeEnvironment.chainId,
  });
  if (data.chainId !== undefined && data.chainId !== activeEnvironment.chainId) {
    return c.json({
      error: `Plans in ${activeEnvironment.name} are locked to chain ${activeEnvironment.chainId}.`,
    }, 409 as any);
  }
  if (!resolvedNetwork) {
    return c.json({
      error:
        "Invalid billing network selection. Choose a supported network and matching USDC token.",
    }, 400 as any);
  }

  const currentTeam = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { platformTier: true },
  });
  if (!currentTeam) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  if (currentTeam.platformTier === "FREE") {
    if (data.annualPrice !== undefined && data.annualPrice > 0) {
      return c.json({
        error: "UPGRADE_REQUIRED",
        message: "Annual billing options are only available on Growth and Enterprise tiers. Free tier plans must use monthly billing only.",
      }, 403 as any);
    }
    if (data.billingInterval > MONTHLY_INTERVAL) {
      return c.json({
        error: "UPGRADE_REQUIRED",
        message: "Annual / custom long-term billing intervals are only available on Growth and Enterprise tiers. Free tier plans are restricted to Monthly billing only.",
      }, 403 as any);
    }
  }

  const tierCheck = await assertCanCreatePlan(auth.team.teamId);
  if (!tierCheck.allowed) {
    return c.json({
        error: "Plan limit reached",
        reason: tierCheck.reason,
        limit: tierCheck.limit,
        current: tierCheck.current,
        upgradeRequired: tierCheck.upgradeRequired,
      }, 403 as any);
  }

  const isFree = data.price === 0;

  const plan = await db.catalogPlan.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
      name: data.name,
      tier: data.tier,
      description: data.description,
      price: data.price.toFixed(6),
      ...(data.annualPrice !== undefined && {
        annualPrice: data.annualPrice.toFixed(6),
      }),
      billingInterval: data.billingInterval,
      acceptedToken: resolvedNetwork.acceptedToken,
      chainId: activeEnvironment.chainId,
      metadata: toPrismaNullableJson(data.metadata),
      status: "DRAFT",
      active: true,
      version: 1,
      chainSyncStatus: isFree ? "NOT_APPLICABLE" : "PENDING",
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: plan.environmentMode,
      entityType: "PLAN",
      entityId: plan.id,
      version: 1,
      status: plan.status,
      snapshot: plan,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.create",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: plan,
  });

  return c.json({ plan }, 201 as any);
}

export async function updatePlan(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await db.catalogPlan.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }
  if (!existing.environmentId) {
    return c.json({ error: "Legacy plans without environments cannot be edited here." }, 409 as any);
  }
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment || existing.environmentId !== activeEnvironment.id) {
    return c.json({ error: "Switch to this plan's environment before editing it." }, 409 as any);
  }
  if (
    parsed.data.chainId !== undefined &&
    parsed.data.chainId !== activeEnvironment.chainId
  ) {
    return c.json({
      error: `Plans in ${activeEnvironment.name} are locked to chain ${activeEnvironment.chainId}.`,
    }, 409 as any);
  }

  const nextVersion = existing.version + 1;
  const existingPrice = parseFloat(existing.price.toString());
  const nextPrice = parsed.data.price ?? existingPrice;
  const existingAnnualPrice = existing.annualPrice
    ? parseFloat(existing.annualPrice.toString())
    : 0;
  const nextAnnualPrice =
    parsed.data.annualPrice === undefined
      ? existingAnnualPrice
      : (parsed.data.annualPrice ?? 0);
  const nextEnvironmentMode = activeEnvironment.mode;
  const nextAcceptedTokenInput =
    parsed.data.acceptedToken ?? existing.acceptedToken;
  const nextChainIdInput = activeEnvironment.chainId;
  const resolvedNetwork =
    parsed.data.acceptedToken !== undefined || parsed.data.chainId !== undefined
      ? resolvePlanNetwork({
          environmentMode: nextEnvironmentMode,
          acceptedToken: nextAcceptedTokenInput,
          requestedChainId: nextChainIdInput,
        })
      : {
          chainId: activeEnvironment.chainId,
          acceptedToken: existing.acceptedToken as `0x${string}`,
        };

  if (!resolvedNetwork) {
    return c.json({
      error:
        "Invalid billing network selection. Choose a supported network and matching USDC token.",
    }, 400 as any);
  }

  const lockedFieldChanges = existing.onChainPlanId
    ? getLockedOnChainFieldChanges(existing, parsed.data)
    : [];

  if (existing.onChainPlanId && lockedFieldChanges.length > 0) {
    return c.json({
        error: `This plan is already registered on-chain. ${lockedFieldChanges.join(
          ", ",
        )} cannot be changed on the existing on-chain plan. Create a new plan to change those fields.`,
      }, 409 as any);
  }

  if (existing.onChainPlanId && parsed.data.price !== undefined && nextPrice === 0) {
    return c.json({
        error:
          "This plan is already registered on-chain. Converting it to a free plan would leave the on-chain plan paid. Create a new free plan instead.",
      }, 409 as any);
  }

  const priceCapChanged =
    resolveMaxOnChainChargeMicrosFromValues({
      price: existingPrice,
      annualPrice: existingAnnualPrice,
    }) !==
    resolveMaxOnChainChargeMicrosFromValues({
      price: nextPrice,
      annualPrice: nextAnnualPrice,
    });
  const onChainRelevantUpdate =
    parsed.data.price !== undefined ||
    parsed.data.annualPrice !== undefined ||
    parsed.data.name !== undefined ||
    parsed.data.tier !== undefined ||
    parsed.data.billingInterval !== undefined ||
    parsed.data.acceptedToken !== undefined ||
    parsed.data.chainId !== undefined;

  const chainSyncUpdate = existing.onChainPlanId
    ? priceCapChanged
      ? {
          chainSyncStatus: "PENDING" as const,
          chainSyncError: null,
          chainSyncedAt: null,
        }
      : {}
    : onChainRelevantUpdate
      ? nextPrice === 0
        ? {
            chainSyncStatus: "NOT_APPLICABLE" as const,
            chainSyncError: null,
            chainSyncedAt: null,
          }
        : {
            chainSyncStatus: "PENDING" as const,
            chainSyncError: null,
            chainSyncedAt: null,
          }
      : {};

  const updated = await db.catalogPlan.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.tier !== undefined && { tier: parsed.data.tier }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description,
      }),
      ...(parsed.data.price !== undefined && {
        price: parsed.data.price.toFixed(6),
      }),
      ...(parsed.data.annualPrice !== undefined && {
        annualPrice:
          parsed.data.annualPrice === null
            ? null
            : parsed.data.annualPrice.toFixed(6),
      }),
      ...(parsed.data.billingInterval !== undefined && {
        billingInterval: parsed.data.billingInterval,
      }),
      ...((parsed.data.acceptedToken !== undefined ||
        parsed.data.chainId !== undefined) && {
        acceptedToken: resolvedNetwork.acceptedToken,
        chainId: activeEnvironment.chainId,
      }),
      ...(parsed.data.metadata !== undefined && {
        metadata: toPrismaNullableJson(parsed.data.metadata),
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      version: nextVersion,
      ...(parsed.data.status === "PUBLISHED" && { publishedAt: new Date() }),
      ...chainSyncUpdate,
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: existing.environmentId,
      environmentMode: updated.environmentMode,
      entityType: "PLAN",
      entityId: updated.id,
      version: updated.version,
      status: updated.status,
      snapshot: updated,
      ...(updated.status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.update",
    resourceType: "CatalogPlan",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  // Auto-add newly published plans to the catalog config's livePlanIds
  // so they appear in the embedded portal immediately.
  const hasEnabledEntitlements = listAllMetadataEntitlements(updated.metadata).some(
    (entitlement) => entitlement.enabled !== false,
  );
  const isPaidPlan = parseFloat(String(updated.price ?? "0")) > 0;

  if (
    parsed.data.status === "PUBLISHED" &&
    updated.status === "PUBLISHED" &&
    (!isPaidPlan || hasEnabledEntitlements)
  ) {
    const config = await db.catalogConfig.findFirst({
      where: {
        teamId: auth.team.teamId,
        environmentId: updated.environmentId ?? undefined,
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, livePlanIds: true },
    });
    if (config) {
      const currentIds: string[] = Array.isArray(config.livePlanIds)
        ? (config.livePlanIds as string[])
        : [];
      if (!currentIds.includes(updated.id)) {
        await db.catalogConfig.update({
          where: { id: config.id },
          data: { livePlanIds: [...currentIds, updated.id] },
        });
      }
    }
  }

  return c.json({ plan: updated });
}

export async function deletePlan(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await db.catalogPlan.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }
  if (!existing.environmentId) {
    return c.json({ error: "Legacy plans without environments cannot be deleted here." }, 409 as any);
  }
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment || existing.environmentId !== activeEnvironment.id) {
    return c.json({ error: "Switch to this plan's environment before deleting it." }, 409 as any);
  }

  if (existing.status === "PUBLISHED") {
    return c.json({ error: "Published plans cannot be deleted. Archive the plan instead." }, 409 as any);
  }

  if (existing.onChainPlanId) {
    return c.json({
        error:
          "On-chain plans cannot be deleted from catalog. Archive or deactivate them instead.",
      }, 409 as any);
  }

  await db.$transaction([
    db.catalogVersion.deleteMany({
      where: {
        teamId: auth.team.teamId,
        entityType: "PLAN",
        entityId: existing.id,
      },
    }),
    db.catalogPlan.delete({ where: { id: existing.id } }),
  ]);

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.delete",
    resourceType: "CatalogPlan",
    resourceId: existing.id,
    beforeData: existing,
  });

  return c.json({ success: true });
}
