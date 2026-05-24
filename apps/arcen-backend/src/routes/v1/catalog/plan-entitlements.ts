import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import {
  requirePermission,
  isErrorResponse,
} from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  syncEntitlementsToFlagRules,
  type PlanEntitlement,
} from "../../../lib/entitlements/sync-entitlements.js";
import {
  listAllMetadataEntitlements,
  listMetadataEntitlements,
  writeMetadataEntitlements,
} from "../../../lib/catalog/catalog-entitlements.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";

const entitlementSchema = z.object({
  featureName: z.string().min(1),
  featureKey: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_\-]+$/i),
  type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).default("BOOLEAN"),
  value: z.union([z.boolean(), z.number(), z.null()]).optional(),
  valueUnit: z.string().trim().nullable().optional(),
  enabled: z.boolean().default(true),
  featureType: z.enum(["boolean", "event", "trait"]).optional(),
  icon: z.string().trim().nullable().optional(),
});

function getEntitlements(metadata: unknown): z.infer<typeof entitlementSchema>[] {
  return listMetadataEntitlements(metadata) as z.infer<typeof entitlementSchema>[];
}

async function enrichEntitlements(
  teamId: string,
  entitlements: z.infer<typeof entitlementSchema>[],
) {
  if (entitlements.length === 0) return entitlements;

  const flags = await db.catalogFeatureFlag.findMany({
    where: {
      teamId,
      featureKey: { in: entitlements.map((entry) => entry.featureKey) },
    },
    select: {
      featureKey: true,
      name: true,
      featureType: true,
      icon: true,
    },
  });

  const flagMap = new Map(flags.map((flag) => [flag.featureKey, flag]));

  return entitlements.map((entry) => {
    const flag = flagMap.get(entry.featureKey);
    return {
      ...entry,
      featureName: entry.featureName || flag?.name || entry.featureKey,
      featureType:
        entry.featureType ??
        (flag?.featureType === "event_based"
          ? "event"
          : flag?.featureType === "trait_based"
            ? "trait"
            : "boolean"),
      icon: entry.icon ?? flag?.icon ?? null,
    };
  });
}

export async function getPlanEntitlements(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const entitlements = await enrichEntitlements(
    auth.team.teamId,
    getEntitlements(plan.metadata),
  );
  return c.json({ entitlements });
}

export async function addPlanEntitlement(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = entitlementSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const existing = [...getEntitlements(plan.metadata)];
  if (existing.some((e) => e.featureKey === parsed.data.featureKey)) {
    return c.json(
      { error: "Feature key already exists on this plan" },
      409 as any,
    );
  }

  const newEntitlements = [...existing, parsed.data];
  const updatedMeta = writeMetadataEntitlements({
    metadata: plan.metadata,
    entitlements: newEntitlements,
  });

  const updated = await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  syncEntitlementsToFlagRules(
    auth.team.teamId,
    plan.id,
    listAllMetadataEntitlements(updatedMeta) as PlanEntitlement[],
  ).catch((err) => console.error("[Entitlements] Flag rule sync failed:", err));

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.entitlement.add",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: parsed.data,
  });

  return c.json(
    { entitlements: newEntitlements, plan: updated },
    201 as any,
  );
}

export async function updatePlanEntitlement(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = z
    .object({
      featureKey: z.string().min(1),
      featureName: z.string().min(1).optional(),
      type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).optional(),
      value: z.union([z.boolean(), z.number(), z.null()]).optional(),
      valueUnit: z.string().trim().nullable().optional(),
      enabled: z.boolean().optional(),
      featureType: z.enum(["boolean", "event", "trait"]).optional(),
      icon: z.string().trim().nullable().optional(),
    })
    .safeParse(body);

  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const existing = [...getEntitlements(plan.metadata)];
  const idx = existing.findIndex(
    (e) => e.featureKey === parsed.data.featureKey,
  );
  if (idx === -1) {
    return c.json({ error: "Entitlement not found" }, 404 as any);
  }

  existing[idx] = { ...existing[idx], ...parsed.data };
  const updatedMeta = writeMetadataEntitlements({
    metadata: plan.metadata,
    entitlements: existing,
  });

  await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  syncEntitlementsToFlagRules(
    auth.team.teamId,
    plan.id,
    listAllMetadataEntitlements(updatedMeta) as PlanEntitlement[],
  ).catch((err) => console.error("[Entitlements] Flag rule sync failed:", err));

  return c.json({ entitlements: existing });
}

export async function deletePlanEntitlement(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth))
    return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const featureKey = c.req.query("featureKey");

  if (!featureKey) {
    return c.json({ error: "featureKey is required" }, 400 as any);
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const existing = [...getEntitlements(plan.metadata)];
  const filtered = existing.filter((e) => e.featureKey !== featureKey);

  if (filtered.length === existing.length) {
    return c.json({ error: "Entitlement not found" }, 404 as any);
  }

  const updatedMeta = writeMetadataEntitlements({
    metadata: plan.metadata,
    entitlements: filtered,
  });

  await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  syncEntitlementsToFlagRules(
    auth.team.teamId,
    plan.id,
    listAllMetadataEntitlements(updatedMeta) as PlanEntitlement[],
  ).catch((err) => console.error("[Entitlements] Flag rule sync failed:", err));

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.entitlement.remove",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: { featureKey },
  });

  return c.json({ entitlements: filtered });
}
