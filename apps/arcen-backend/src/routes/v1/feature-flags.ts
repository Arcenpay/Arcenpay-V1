/**
 * GET  /api/v1/feature-flags   — List feature flags (dashboard session auth)
 * POST /api/v1/feature-flags   — Create a feature flag
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import { loadPublishedPlanEntitlementsByFeatureKey } from "../../lib/catalog/catalog-entitlements.js";
import { getTierLimits, TIER_FEATURES } from "../../lib/catalog/tier-guard.js";

export async function GET(c: Context) {
  const ctx = await requirePermission(c, "catalog:read");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;

  const [flags, planEntitlementsByFeatureKey] = await Promise.all([
    db.catalogFeatureFlag.findMany({
      where: { teamId: team.teamId },
      include: {
        rules: {
          orderBy: { priority: "asc" },
          include: { conditions: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    loadPublishedPlanEntitlementsByFeatureKey(team.teamId),
  ]);

  const data = flags.map((flag) => ({
    ...flag,
    rules: flag.rules.filter(
      (rule) =>
        rule.source !== "plan" &&
        !rule.conditions.some((condition) => condition.criteriaType === "base_plan"),
    ),
    linkedPlans: (planEntitlementsByFeatureKey.get(flag.featureKey) ?? []).map(
      ({ id, name, tier }) => ({ id, name, tier }),
    ),
    planEntitlements: planEntitlementsByFeatureKey.get(flag.featureKey) ?? [],
    planRules: (planEntitlementsByFeatureKey.get(flag.featureKey) ?? []).map((planEntitlement) => ({
      id: `plan-rule-${flag.featureKey}-${planEntitlement.id}`,
      priority: 100,
      value: true,
      source: "plan",
      sourceId: planEntitlement.id,
      conditions: [
        {
          id: `plan-condition-${flag.featureKey}-${planEntitlement.id}`,
          ruleId: `plan-rule-${flag.featureKey}-${planEntitlement.id}`,
          criteriaType: "base_plan",
          operator: "is_one_of",
          values: [planEntitlement.id],
          metricKey: null,
          metricValue: null,
          metricPeriod: null,
          traitKey: null,
          zktlsProviderId: null,
        },
        ...(planEntitlement.type === "NUMERIC" && typeof planEntitlement.value === "number"
          ? [
              {
                id: `usage-condition-${flag.featureKey}-${planEntitlement.id}`,
                ruleId: `plan-rule-${flag.featureKey}-${planEntitlement.id}`,
                criteriaType: "usage",
                operator: "is_less_than",
                values: [],
                metricKey: flag.eventKey ?? flag.featureKey,
                metricValue: Number(planEntitlement.value),
                metricPeriod: "monthly",
                traitKey: null,
                zktlsProviderId: null,
              },
            ]
          : []),
      ],
    })),
  }));

  return c.json({ data });
}

export async function POST(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;

  let body: {
    featureKey: string;
    name: string;
    description?: string;
    featureType?: string;
    eventKey?: string;
    icon?: string;
    unitSingular?: string;
    unitPlural?: string;
    defaultValue?: boolean;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.featureKey || !body.name) {
    return c.json({ error: "featureKey and name are required" }, 400 as any);
  }

  // ── Field length validation ──────────────────────────────────
  if (body.featureKey.length > 128) {
    return c.json({ error: "featureKey too long" }, 400 as any);
  }
  if (body.name.length > 128) {
    return c.json({ error: "name too long" }, 400 as any);
  }
  if (body.description !== undefined && body.description.length > 256) {
    return c.json({ error: "description too long" }, 400 as any);
  }

  // Validate featureKey format — must start and end with alphanumeric
  if (!/^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$/i.test(body.featureKey)) {
    return c.json({ error: "featureKey must start and end with an alphanumeric character and contain only letters, numbers, hyphens, and underscores" }, 400 as any);
  }

  const currentTeam = await db.team.findUnique({
    where: { id: team.teamId },
    select: { platformTier: true },
  });
  if (!currentTeam) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const limits = await getTierLimits(currentTeam.platformTier);
  const currentFlagCount = await db.catalogFeatureFlag.count({
    where: { teamId: team.teamId },
  });
  if (currentFlagCount >= limits.maxFeatureFlags) {
    return c.json({
      error: "LIMIT_REACHED",
      message: `You have reached the limit of ${limits.maxFeatureFlags} feature flags for your ${currentTeam.platformTier} plan. Please upgrade to create more.`,
    }, 409 as any);
  }

  const reqType = body.featureType ?? "boolean";
  const features = TIER_FEATURES[currentTeam.platformTier];
  if (!features.customBranding && reqType !== "boolean") {
    return c.json({
      error: "UPGRADE_REQUIRED",
      message: "Non-boolean feature flags (Numeric, event_based, trait_based) are only available on Growth and Enterprise plans. Please upgrade your platform billing plan.",
    }, 403 as any);
  }

  const existing = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId: team.teamId, featureKey: body.featureKey } },
  });

  if (existing) {
    return c.json({ error: "A flag with this key already exists" }, 409 as any);
  }

  const flag = await db.catalogFeatureFlag.create({
    data: {
      teamId: team.teamId,
      featureKey: body.featureKey,
      name: body.name,
      description: body.description,
      featureType: body.featureType ?? "boolean",
      eventKey: body.eventKey,
      icon: body.icon ?? null,
      unitSingular: body.unitSingular,
      unitPlural: body.unitPlural,
      defaultValue: body.defaultValue ?? false,
    },
  });

  return c.json({ data: flag }, 201 as any);
}
