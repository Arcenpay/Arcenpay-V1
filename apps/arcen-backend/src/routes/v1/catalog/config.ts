import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

const envModeSchema = z.enum(["DEVELOPMENT", "PRODUCTION"]);

const querySchema = z.object({
  environmentMode: envModeSchema.optional(),
});

const updateSchema = z.object({
  environmentMode: envModeSchema.optional(),
  initialPlan: z.string().min(1).max(64),
  fallbackPlan: z.string().min(1).max(64).nullable(),
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

  const config = await db.catalogConfig.upsert({
    where: {
      environmentId: activeEnvironment.id,
    },
    update: {},
    create: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
    },
  });

  return c.json({ config });
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

  const config = await db.catalogConfig.upsert({
    where: { environmentId: activeEnvironment.id },
    update: {
      initialPlan,
      fallbackPlan,
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
      initialPlan,
      fallbackPlan,
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
