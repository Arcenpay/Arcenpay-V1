import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";
import { assertCanCreatePlan } from "../../../lib/catalog/tier-guard.js";

const listSchema = z.object({
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  tier: z.string().min(1),
  description: z.string().optional(),
  price: z.coerce.number().nonnegative(),
  annualPrice: z.coerce.number().nonnegative().optional(),
  billingInterval: z.coerce.number().int().positive(),
  acceptedToken: z.string().min(1),
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
  billingInterval: z.coerce.number().int().positive().optional(),
  acceptedToken: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

function normalizeComparableAddress(value: string): string {
  return value.trim().toLowerCase();
}

function getLockedOnChainFieldChanges(
  existing: {
    name: string;
    tier: string;
    billingInterval: number;
    acceptedToken: string;
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

  const plans = await db.catalogPlan.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(parsed.data.environmentMode && {
        environmentMode: parsed.data.environmentMode,
      }),
      ...(parsed.data.status && { status: parsed.data.status }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const freePlansToFix = plans.filter(
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

  return c.json({ plans });
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
      environmentMode: data.environmentMode,
      name: data.name,
      tier: data.tier,
      description: data.description,
      price: data.price.toFixed(6),
      ...(data.annualPrice !== undefined && {
        annualPrice: data.annualPrice.toFixed(6),
      }),
      billingInterval: data.billingInterval,
      acceptedToken: data.acceptedToken,
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

  const nextVersion = existing.version + 1;
  const existingPrice = parseFloat(existing.price.toString());
  const nextPrice = parsed.data.price ?? existingPrice;
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

  const priceChanged =
    parsed.data.price !== undefined && parsed.data.price !== existingPrice;
  const onChainRelevantUpdate =
    parsed.data.price !== undefined ||
    parsed.data.name !== undefined ||
    parsed.data.tier !== undefined ||
    parsed.data.billingInterval !== undefined ||
    parsed.data.acceptedToken !== undefined;

  const chainSyncUpdate = existing.onChainPlanId
    ? priceChanged
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
      ...(parsed.data.acceptedToken !== undefined && {
        acceptedToken: parsed.data.acceptedToken,
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
