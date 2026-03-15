import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";

// Entitlements are stored as JSON in CatalogAddOn.metadata under the key "entitlements"
// We use raw SQL for all metadata reads/writes to avoid stale Prisma client schema validation.

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

// Raw SQL helpers — bypass Prisma client schema validation for the metadata jsonb column
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

// GET /api/catalog/add-ons/[id]/entitlements
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requirePermission("catalog:read");
        if (isErrorResponse(auth)) return auth;

        const { id } = await params;
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
        }

        return NextResponse.json({ entitlements: getEntitlements(addOn.metadata) });
    } catch (err) {
        console.error("[add-ons entitlements GET]", err);
        return NextResponse.json(
            { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        );
    }
}

// POST /api/catalog/add-ons/[id]/entitlements — add a new entitlement
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requirePermission("catalog:write");
        if (isErrorResponse(auth)) return auth;

        const { id } = await params;
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
        }

        const body = await request.json().catch(() => ({}));
        const parsed = entitlementSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        const existing = getEntitlements(addOn.metadata);
        if (existing.some((e) => e.featureKey === parsed.data.featureKey)) {
            return NextResponse.json(
                { error: "Feature key already exists on this add-on" },
                { status: 409 }
            );
        }

        const newEntitlements = [...existing, parsed.data];
        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: newEntitlements,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);

        await writeAuditEvent({
            request,
            teamId: auth.team.teamId,
            userId: auth.team.userId,
            walletAddress: auth.team.walletAddress,
            action: "catalog.addon.entitlement.add",
            resourceType: "CatalogAddOn",
            resourceId: addOn.id,
            afterData: parsed.data,
        });

        return NextResponse.json({ entitlements: newEntitlements }, { status: 201 });
    } catch (err) {
        console.error("[add-ons entitlements POST]", err);
        return NextResponse.json(
            { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        );
    }
}

// PUT /api/catalog/add-ons/[id]/entitlements — update an entitlement by featureKey
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requirePermission("catalog:write");
        if (isErrorResponse(auth)) return auth;

        const { id } = await params;
        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
        }

        const body = await request.json().catch(() => ({}));
        const parsed = z.object({
            featureKey: z.string().min(1),
            featureName: z.string().min(1).optional(),
            type: z.enum(["BOOLEAN", "NUMERIC", "UNLIMITED"]).optional(),
            value: z.union([z.boolean(), z.number(), z.null()]).optional(),
            enabled: z.boolean().optional(),
        }).safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
                { status: 400 }
            );
        }

        const existing = getEntitlements(addOn.metadata);
        const idx = existing.findIndex((e) => e.featureKey === parsed.data.featureKey);
        if (idx === -1) {
            return NextResponse.json({ error: "Entitlement not found" }, { status: 404 });
        }

        existing[idx] = { ...existing[idx], ...parsed.data };
        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: existing,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);
        return NextResponse.json({ entitlements: existing });
    } catch (err) {
        console.error("[add-ons entitlements PUT]", err);
        return NextResponse.json(
            { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        );
    }
}

// DELETE /api/catalog/add-ons/[id]/entitlements?featureKey=xxx
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const auth = await requirePermission("catalog:write");
        if (isErrorResponse(auth)) return auth;

        const { id } = await params;
        const featureKey = request.nextUrl.searchParams.get("featureKey");
        if (!featureKey) {
            return NextResponse.json({ error: "featureKey is required" }, { status: 400 });
        }

        const addOn = await findAddOnRaw(id, auth.team.teamId);
        if (!addOn) {
            return NextResponse.json({ error: "Add-on not found" }, { status: 404 });
        }

        const existing = getEntitlements(addOn.metadata);
        const filtered = existing.filter((e) => e.featureKey !== featureKey);
        if (filtered.length === existing.length) {
            return NextResponse.json({ error: "Entitlement not found" }, { status: 404 });
        }

        const updatedMeta = {
            ...((addOn.metadata as Record<string, unknown>) ?? {}),
            entitlements: filtered,
        };

        await updateMetadataRaw(addOn.id, updatedMeta);

        await writeAuditEvent({
            request,
            teamId: auth.team.teamId,
            userId: auth.team.userId,
            walletAddress: auth.team.walletAddress,
            action: "catalog.addon.entitlement.remove",
            resourceType: "CatalogAddOn",
            resourceId: addOn.id,
            afterData: { featureKey },
        });

        return NextResponse.json({ entitlements: filtered });
    } catch (err) {
        console.error("[add-ons entitlements DELETE]", err);
        return NextResponse.json(
            { error: "Internal server error", detail: err instanceof Error ? err.message : String(err) },
            { status: 500 }
        );
    }
}
