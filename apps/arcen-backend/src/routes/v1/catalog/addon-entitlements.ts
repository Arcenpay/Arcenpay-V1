import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const entitlementSchema = z.object({
    featureName: z.string().min(1),
    featureKey: z.string().min(1).regex(/^[a-z0-9_\-]+$/i),
    type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).default("BOOLEAN"),
    value: z.union([z.boolean(), z.number(), z.null()]).optional(),
    enabled: z.boolean().default(true),
});

function getEntitlements(metadata: unknown): z.infer<typeof entitlementSchema>[] {
    if (!metadata || typeof metadata !== "object") return [];
    const meta = metadata as Record<string, unknown>;
    if (!Array.isArray(meta.entitlements)) return [];
    return meta.entitlements as z.infer<typeof entitlementSchema>[];
}

async function findAddOnRaw(id: string, teamId: string): Promise<{ id: string; metadata: unknown } | null> {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; metadata: unknown }>>(
        `SELECT "id", "metadata" FROM "CatalogAddOn" WHERE "id" = $1 AND "teamId" = $2 LIMIT 1`,
        id,
        teamId,
    );
    return rows[0] ?? null;
}

async function updateMetadataRaw(id: string, metadata: unknown): Promise<void> {
    await db.$executeRawUnsafe(
        `UPDATE "CatalogAddOn" SET "metadata" = $1::jsonb, "updatedAt" = NOW() WHERE "id" = $2`,
        JSON.stringify(metadata),
        id,
    );
}

export async function getAddOnEntitlements(c: Context) {
    try {
        const auth = await requirePermission(c, "catalog:read");
        if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

        const id = c.req.param("id");
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return c.json({ error: "Add-on not found" }, 404 as any);
        }

        return c.json({ entitlements: getEntitlements(addOn.metadata) });
    } catch (err) {
        console.error("[add-ons entitlements GET]", err);
        return c.json({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }, 500 as any);
    }
}

export async function addAddOnEntitlement(c: Context) {
    try {
        const auth = await requirePermission(c, "catalog:write");
        if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

        const id = c.req.param("id");
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return c.json({ error: "Add-on not found" }, 404 as any);
        }

        const body = await c.req.json() .catch(() => ({}));
        const parsed = entitlementSchema.safeParse(body);
        if (!parsed.success) {
            return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
        }

        const existing = getEntitlements(addOn.metadata);
        if (existing.some((e) => e.featureKey === parsed.data.featureKey)) {
            return c.json({ error: "Feature key already exists on this add-on" }, 409 as any);
        }

        const newEntitlements = [...existing, parsed.data];
        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: newEntitlements,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);

        await writeAuditEvent({
            headers: c.req.raw.headers,
            teamId: auth.team.teamId,
            userId: auth.team.userId,
            walletAddress: auth.team.walletAddress,
            action: "catalog.addon.entitlement.add",
            resourceType: "CatalogAddOn",
            resourceId: addOn.id,
            afterData: parsed.data,
        });

        return c.json({ entitlements: newEntitlements }, 201 as any);
    } catch (err) {
        console.error("[add-ons entitlements POST]", err);
        return c.json({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }, 500 as any);
    }
}

export async function updateAddOnEntitlement(c: Context) {
    try {
        const auth = await requirePermission(c, "catalog:write");
        if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

        const id = c.req.param("id");
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return c.json({ error: "Add-on not found" }, 404 as any);
        }

        const body = await c.req.json() .catch(() => ({}));
        const parsed = z.object({
            featureKey: z.string().min(1),
            featureName: z.string().min(1).optional(),
            type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).optional(),
            value: z.union([z.boolean(), z.number(), z.null()]).optional(),
            enabled: z.boolean().optional(),
        }).safeParse(body);

        if (!parsed.success) {
            return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
        }

        const existing = getEntitlements(addOn.metadata);
        const idx = existing.findIndex((e) => e.featureKey === parsed.data.featureKey);
        if (idx === -1) {
            return c.json({ error: "Entitlement not found" }, 404 as any);
        }

        existing[idx] = { ...existing[idx], ...parsed.data };
        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: existing,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);
        return c.json({ entitlements: existing });
    } catch (err) {
        console.error("[add-ons entitlements PUT]", err);
        return c.json({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }, 500 as any);
    }
}

export async function deleteAddOnEntitlement(c: Context) {
    try {
        const auth = await requirePermission(c, "catalog:write");
        if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

        const id = c.req.param("id");
        const featureKey = c.req.query("featureKey");
        if (!featureKey) {
            return c.json({ error: "featureKey is required" }, 400 as any);
        }

        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return c.json({ error: "Add-on not found" }, 404 as any);
        }

        const existing = getEntitlements(addOn.metadata);
        const filtered = existing.filter((e) => e.featureKey !== featureKey);
        if (filtered.length === existing.length) {
            return c.json({ error: "Entitlement not found" }, 404 as any);
        }

        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: filtered,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);

        await writeAuditEvent({
            headers: c.req.raw.headers,
            teamId: auth.team.teamId,
            userId: auth.team.userId,
            walletAddress: auth.team.walletAddress,
            action: "catalog.addon.entitlement.remove",
            resourceType: "CatalogAddOn",
            resourceId: addOn.id,
            afterData: { featureKey },
        });

        return c.json({ entitlements: filtered });
    } catch (err) {
        console.error("[add-ons entitlements DELETE]", err);
        return c.json({ error: "Internal server error", detail: err instanceof Error ? err.message : String(err) }, 500 as any);
    }
}
