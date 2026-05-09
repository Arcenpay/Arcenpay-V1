import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { syncEntitlementsToFlagRules, type PlanEntitlement } from "../../../lib/entitlements/sync-entitlements.js";

const entitlementSchema = z.object({
    featureName: z.string().min(1),
    featureKey: z.string().min(1).regex(/^[a-z0-9_\-]+$/i),
    type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).default("BOOLEAN"),
    value: z.union([z.boolean(), z.number(), z.null()]).optional(),
    valueUnit: z.string().trim().nullable().optional(),
    enabled: z.boolean().default(true),
});

function getEntitlements(metadata: unknown): z.infer<typeof entitlementSchema>[] {
    if (!metadata || typeof metadata !== "object") return [];
    const meta = metadata as Record<string, unknown>;
    if (!Array.isArray(meta.entitlements)) return [];
    return meta.entitlements as z.infer<typeof entitlementSchema>[];
}

export async function getPlanEntitlements(c: Context) {
    const auth = await requirePermission(c, "catalog:read");
    if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

    const id = c.req.param("id");

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return c.json({ error: "Plan not found" }, 404 as any);
    }

    const entitlements = getEntitlements(plan.metadata);
    return c.json({ entitlements });
}

export async function addPlanEntitlement(c: Context) {
    const auth = await requirePermission(c, "catalog:write");
    if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

    const id = c.req.param("id");

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return c.json({ error: "Plan not found" }, 404 as any);
    }

    const body = await c.req.json() .catch(() => ({}));
    const parsed = entitlementSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
    }

    const existing = getEntitlements(plan.metadata);
    if (existing.some((e) => e.featureKey === parsed.data.featureKey)) {
        return c.json({ error: "Feature key already exists on this plan" }, 409 as any);
    }

    const newEntitlements = [...existing, parsed.data];
    const updatedMeta = {
        ...((plan.metadata as Record<string, unknown>) ?? {}),
        entitlements: newEntitlements,
    };

    const updated = await db.catalogPlan.update({
        where: { id: plan.id },
        data: { metadata: updatedMeta },
    });

    syncEntitlementsToFlagRules(auth.team.teamId, plan.id, newEntitlements as PlanEntitlement[]).catch(
        (err) => console.error("[Entitlements] Flag rule sync failed:", err),
    );

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

    return c.json({ entitlements: newEntitlements, plan: updated }, 201 as any);
}

export async function updatePlanEntitlement(c: Context) {
    const auth = await requirePermission(c, "catalog:write");
    if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

    const id = c.req.param("id");

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return c.json({ error: "Plan not found" }, 404 as any);
    }

    const body = await c.req.json() .catch(() => ({}));
    const parsed = z.object({
        featureKey: z.string().min(1),
        featureName: z.string().min(1).optional(),
        type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).optional(),
        value: z.union([z.boolean(), z.number(), z.null()]).optional(),
        valueUnit: z.string().trim().nullable().optional(),
        enabled: z.boolean().optional(),
    }).safeParse(body);

    if (!parsed.success) {
        return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
    }

    const existing = getEntitlements(plan.metadata);
    const idx = existing.findIndex((e) => e.featureKey === parsed.data.featureKey);
    if (idx === -1) {
        return c.json({ error: "Entitlement not found" }, 404 as any);
    }

    existing[idx] = { ...existing[idx], ...parsed.data };
    const updatedMeta = {
        ...((plan.metadata as Record<string, unknown>) ?? {}),
        entitlements: existing,
    };

    await db.catalogPlan.update({
        where: { id: plan.id },
        data: { metadata: updatedMeta },
    });

    syncEntitlementsToFlagRules(auth.team.teamId, plan.id, existing as PlanEntitlement[]).catch(
        (err) => console.error("[Entitlements] Flag rule sync failed:", err),
    );

    return c.json({ entitlements: existing });
}

export async function deletePlanEntitlement(c: Context) {
    const auth = await requirePermission(c, "catalog:write");
    if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

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

    const existing = getEntitlements(plan.metadata);
    const filtered = existing.filter((e) => e.featureKey !== featureKey);

    if (filtered.length === existing.length) {
        return c.json({ error: "Entitlement not found" }, 404 as any);
    }

    const updatedMeta = {
        ...((plan.metadata as Record<string, unknown>) ?? {}),
        entitlements: filtered,
    };

    await db.catalogPlan.update({
        where: { id: plan.id },
        data: { metadata: updatedMeta },
    });

    syncEntitlementsToFlagRules(auth.team.teamId, plan.id, filtered as PlanEntitlement[]).catch(
        (err) => console.error("[Entitlements] Flag rule sync failed:", err),
    );

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
