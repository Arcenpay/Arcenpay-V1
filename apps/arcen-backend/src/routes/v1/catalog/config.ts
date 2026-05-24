import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { listMetadataEntitlements } from "../../../lib/catalog/catalog-entitlements.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const envModeSchema = z.enum(["DEVELOPMENT", "PRODUCTION"]);
const liveSelectionSchema = z.array(z.string().min(1).max(64)).max(200);

const querySchema = z.object({
  environmentMode: envModeSchema.optional(),
});

const updateSchema = z.object({
  environmentMode: envModeSchema.optional(),
  initialPlan: z.string().min(1).max(64),
  fallbackPlan: z.string().min(1).max(64).nullable(),
  livePlanIds: liveSelectionSchema.nullable().optional(),
  liveAddOnIds: liveSelectionSchema.nullable().optional(),
  liveCreditTypeIds: liveSelectionSchema.nullable().optional(),
  showBillingPeriodToggle: z.boolean(),
  freePlanPriceDisplay: z.boolean(),
  hideCredits: z.boolean(),
  yearlyDiscountDisplay: z.boolean(),
  showFeatureDescriptions: z.boolean(),
  showHardLimits: z.boolean(),
  upgradeImmediately: z.boolean(),
  downgradeImmediately: z.boolean(),
  preventDowngradeOverLimit: z.boolean(),
  disallowSelfServiceDowngrade: z.boolean(),
});

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getCreditBundleCount(metadata: unknown): number {
  const bundles = asRecord(metadata).bundles;
  return Array.isArray(bundles) ? bundles.length : 0;
}

function countEnabledPlanEntitlements(metadata: unknown): number {
  return listMetadataEntitlements(metadata).filter(
    (entitlement) => entitlement.enabled !== false,
  ).length;
}

function canPlanGoLive(plan: { price: unknown; metadata?: unknown }): boolean {
  const isPaid = parseFloat(String(plan.price ?? "0")) > 0;
  if (!isPaid) return true;
  return countEnabledPlanEntitlements(plan.metadata) > 0;
}

function normalizeConfiguredPlanId(
  value: string | null | undefined,
  plans: Array<{ id: string; name: string; tier: string }>,
): string | null {
  const candidate = value?.trim();
  if (!candidate || candidate === "none") return null;

  const match = plans.find(
    (plan) =>
      plan.id === candidate || plan.name === candidate || plan.tier === candidate,
  );

  return match?.id ?? null;
}

function validateSelectionIds(
  ids: string[] | null | undefined,
  validIds: Set<string>,
  label: string,
): string | null {
  if (!ids) return null;
  const invalid = ids.filter((id) => !validIds.has(id));
  if (invalid.length === 0) return null;
  return `${label} must belong to published items in the active environment. Invalid ids: ${invalid.join(", ")}`;
}

function dedupeIds(ids: string[] | null): string[] | null {
  if (!ids) return null;
  return Array.from(new Set(ids));
}

async function loadEnvironmentScopedCatalog(teamId: string, environmentId: string) {
  const [plans, addOns, creditTypes, companies, activeAddOnGrants] = await Promise.all([
    db.catalogPlan.findMany({
      where: {
        teamId,
        environmentId,
        status: "PUBLISHED",
        active: true,
      },
      orderBy: [{ price: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        tier: true,
        price: true,
        annualPrice: true,
        billingInterval: true,
        acceptedToken: true,
        chainId: true,
        metadata: true,
        updatedAt: true,
      },
    }),
    db.catalogAddOn.findMany({
      where: {
        teamId,
        environmentId,
        status: "PUBLISHED",
        active: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        billingType: true,
        saleMode: true,
        price: true,
        billingIntervalDays: true,
        acceptedToken: true,
        updatedAt: true,
      },
    }),
    db.catalogCreditType.findMany({
      where: {
        teamId,
        environmentId,
        status: "PUBLISHED",
        active: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      select: {
        id: true,
        name: true,
        code: true,
        unitName: true,
        unitsPerPack: true,
        price: true,
        acceptedToken: true,
        metadata: true,
        updatedAt: true,
      },
    }),
    db.arcenCompany.findMany({
      where: {
        teamId,
        environmentId,
        activePlanId: { not: null },
      },
      select: {
        activePlanId: true,
      },
    }),
    db.companyAddOnGrant.findMany({
      where: {
        teamId,
        status: "ACTIVE",
        company: {
          environmentId,
        },
      },
      select: {
        catalogAddOnId: true,
      },
    }),
  ]);

  const planCompanyCounts = new Map<string, number>();
  for (const company of companies) {
    if (!company.activePlanId) continue;
    planCompanyCounts.set(
      company.activePlanId,
      (planCompanyCounts.get(company.activePlanId) ?? 0) + 1,
    );
  }

  const addOnGrantCounts = new Map<string, number>();
  for (const grant of activeAddOnGrants) {
    addOnGrantCounts.set(
      grant.catalogAddOnId,
      (addOnGrantCounts.get(grant.catalogAddOnId) ?? 0) + 1,
    );
  }

  return {
    plans,
    addOns,
    creditTypes,
    catalog: {
      plans: plans
        .filter((plan) => canPlanGoLive(plan))
        .map((plan) => ({
          ...plan,
          companyCount: planCompanyCounts.get(plan.id) ?? 0,
        })),
      addOns: addOns.map((addOn) => ({
        ...addOn,
        grantCount: addOnGrantCounts.get(addOn.id) ?? 0,
      })),
      creditTypes: creditTypes.map((creditType) => ({
        ...creditType,
        bundleCount: getCreditBundleCount(creditType.metadata),
      })),
    },
  };
}

export async function getCatalogConfig(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const parsed = querySchema.safeParse(c.req.query());
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

  const [config, catalogData] = await Promise.all([
    db.catalogConfig.upsert({
      where: {
        environmentId: activeEnvironment.id,
      },
      update: {},
      create: {
        teamId: auth.team.teamId,
        environmentId: activeEnvironment.id,
        environmentMode: activeEnvironment.mode,
      },
    }),
    loadEnvironmentScopedCatalog(auth.team.teamId, activeEnvironment.id),
  ]);

  return c.json({
    config: {
      ...config,
      livePlanIds: config.restrictLivePlans ? config.livePlanIds : null,
      liveAddOnIds: config.restrictLiveAddOns ? config.liveAddOnIds : null,
      liveCreditTypeIds: config.restrictLiveCreditTypes
        ? config.liveCreditTypeIds
        : null,
    },
    catalog: catalogData.catalog,
  });
}

export async function updateCatalogConfig(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const {
    initialPlan,
    fallbackPlan,
    livePlanIds,
    liveAddOnIds,
    liveCreditTypeIds,
    showBillingPeriodToggle,
    freePlanPriceDisplay,
    hideCredits,
    yearlyDiscountDisplay,
    showFeatureDescriptions,
    showHardLimits,
    upgradeImmediately,
    downgradeImmediately,
    preventDowngradeOverLimit,
    disallowSelfServiceDowngrade,
  } = parsed.data;

  const existing = await db.catalogConfig.findUnique({
    where: { environmentId: activeEnvironment.id },
  });

  const catalogData = await loadEnvironmentScopedCatalog(
    auth.team.teamId,
    activeEnvironment.id,
  );
  const publishedPlanIds = new Set(catalogData.plans.map((plan) => plan.id));
  const publishedAddOnIds = new Set(catalogData.addOns.map((addOn) => addOn.id));
  const publishedCreditTypeIds = new Set(
    catalogData.creditTypes.map((creditType) => creditType.id),
  );

  const normalizedInitialPlanId = normalizeConfiguredPlanId(
    initialPlan,
    catalogData.plans,
  );
  if (initialPlan !== "none" && !normalizedInitialPlanId) {
    return c.json(
      {
        error:
          "Initial plan must be a published plan in the active environment.",
      },
      400 as any,
    );
  }

  const normalizedFallbackPlanId = normalizeConfiguredPlanId(
    fallbackPlan,
    catalogData.plans,
  );
  if (fallbackPlan && fallbackPlan !== "none" && !normalizedFallbackPlanId) {
    return c.json(
      {
        error:
          "Fallback plan must be a published plan in the active environment.",
      },
      400 as any,
    );
  }

  const livePlanValidationError = validateSelectionIds(
    livePlanIds,
    publishedPlanIds,
    "Live plans",
  );
  if (livePlanValidationError) {
    return c.json({ error: livePlanValidationError }, 400 as any);
  }

  const liveAddOnValidationError = validateSelectionIds(
    liveAddOnIds,
    publishedAddOnIds,
    "Live add-ons",
  );
  if (liveAddOnValidationError) {
    return c.json({ error: liveAddOnValidationError }, 400 as any);
  }

  const liveCreditTypeValidationError = validateSelectionIds(
    liveCreditTypeIds,
    publishedCreditTypeIds,
    "Live credit bundles",
  );
  if (liveCreditTypeValidationError) {
    return c.json({ error: liveCreditTypeValidationError }, 400 as any);
  }

  let resolvedLivePlanIds =
    livePlanIds !== undefined
      ? dedupeIds(livePlanIds)
      : existing?.restrictLivePlans
        ? existing.livePlanIds
        : null;
  if (resolvedLivePlanIds) {
    const normalizedLivePlanIds = new Set(resolvedLivePlanIds);
    if (normalizedInitialPlanId) normalizedLivePlanIds.add(normalizedInitialPlanId);
    if (normalizedFallbackPlanId) normalizedLivePlanIds.add(normalizedFallbackPlanId);
    resolvedLivePlanIds = Array.from(normalizedLivePlanIds);
  }

  const resolvedLiveAddOnIds =
    liveAddOnIds !== undefined
      ? dedupeIds(liveAddOnIds)
      : existing?.restrictLiveAddOns
        ? existing.liveAddOnIds
        : null;
  const resolvedLiveCreditTypeIds =
    liveCreditTypeIds !== undefined
      ? dedupeIds(liveCreditTypeIds)
      : existing?.restrictLiveCreditTypes
        ? existing.liveCreditTypeIds
        : null;

  const restrictLivePlans = livePlanIds !== undefined || !!existing?.restrictLivePlans;
  const restrictLiveAddOns =
    liveAddOnIds !== undefined || !!existing?.restrictLiveAddOns;
  const restrictLiveCreditTypes =
    liveCreditTypeIds !== undefined || !!existing?.restrictLiveCreditTypes;

  const config = await db.catalogConfig.upsert({
    where: { environmentId: activeEnvironment.id },
    update: {
      initialPlan: normalizedInitialPlanId ?? "none",
      fallbackPlan: normalizedFallbackPlanId,
      livePlanIds: restrictLivePlans ? resolvedLivePlanIds ?? [] : [],
      liveAddOnIds: restrictLiveAddOns ? resolvedLiveAddOnIds ?? [] : [],
      liveCreditTypeIds:
        restrictLiveCreditTypes ? resolvedLiveCreditTypeIds ?? [] : [],
      restrictLivePlans,
      restrictLiveAddOns,
      restrictLiveCreditTypes,
      showBillingPeriodToggle,
      freePlanPriceDisplay,
      hideCredits,
      yearlyDiscountDisplay,
      showFeatureDescriptions,
      showHardLimits,
      upgradeImmediately,
      downgradeImmediately,
      preventDowngradeOverLimit,
      disallowSelfServiceDowngrade,
    },
    create: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
      initialPlan: normalizedInitialPlanId ?? "none",
      fallbackPlan: normalizedFallbackPlanId,
      livePlanIds: restrictLivePlans ? resolvedLivePlanIds ?? [] : [],
      liveAddOnIds: restrictLiveAddOns ? resolvedLiveAddOnIds ?? [] : [],
      liveCreditTypeIds:
        restrictLiveCreditTypes ? resolvedLiveCreditTypeIds ?? [] : [],
      restrictLivePlans,
      restrictLiveAddOns,
      restrictLiveCreditTypes,
      showBillingPeriodToggle,
      freePlanPriceDisplay,
      hideCredits,
      yearlyDiscountDisplay,
      showFeatureDescriptions,
      showHardLimits,
      upgradeImmediately,
      downgradeImmediately,
      preventDowngradeOverLimit,
      disallowSelfServiceDowngrade,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.config.update",
    resourceType: "CatalogConfig",
    resourceId: config.id,
    beforeData: existing,
    afterData: config,
  });

  return c.json({ config });
}
