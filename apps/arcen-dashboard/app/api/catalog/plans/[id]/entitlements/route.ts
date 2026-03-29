import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { syncEntitlementsToFlagRules, type PlanEntitlement } from "@/lib/sync-entitlements";

// Entitlements are stored as JSON in CatalogPlan.metadata under the key "entitlements"
// Shape: { featureName: string, featureKey: string, type: "BOOLEAN" | "NUMERIC" | "UNLIMITED", value: boolean | number | null, enabled: boolean }[]

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

// GET /api/catalog/plans/[id]/entitlements
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission("catalog:read");
    if (isErrorResponse(auth)) return auth;

    const { id } = await params;

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const entitlements = getEntitlements(plan.metadata);
    return NextResponse.json({ entitlements });
}

// POST /api/catalog/plans/[id]/entitlements — add a new entitlement
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission("catalog:write");
    if (isErrorResponse(auth)) return auth;

    const { id } = await params;

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = entitlementSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    const existing = getEntitlements(plan.metadata);
    // Check for duplicate featureKey
    if (existing.some((e) => e.featureKey === parsed.data.featureKey)) {
        return NextResponse.json(
            { error: "Feature key already exists on this plan" },
            { status: 409 }
        );
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

    // Auto-sync entitlements to flag rules (fire-and-forget for performance)
    syncEntitlementsToFlagRules(auth.team.teamId, plan.id, newEntitlements as PlanEntitlement[]).catch(
        (err) => console.error("[Entitlements] Flag rule sync failed:", err),
    );

    await writeAuditEvent({
        request,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: auth.team.walletAddress,
        action: "catalog.plan.entitlement.add",
        resourceType: "CatalogPlan",
        resourceId: plan.id,
        afterData: parsed.data,
    });

    return NextResponse.json({ entitlements: newEntitlements, plan: updated }, { status: 201 });
}

// PUT /api/catalog/plans/[id]/entitlements — update an entitlement by featureKey
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission("catalog:write");
    if (isErrorResponse(auth)) return auth;

    const { id } = await params;

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
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

    const existing = getEntitlements(plan.metadata);
    const idx = existing.findIndex((e) => e.featureKey === parsed.data.featureKey);
    if (idx === -1) {
        return NextResponse.json({ error: "Entitlement not found" }, { status: 404 });
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

    return NextResponse.json({ entitlements: existing });
}

// DELETE /api/catalog/plans/[id]/entitlements?featureKey=xxx
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission("catalog:write");
    if (isErrorResponse(auth)) return auth;

    const { id } = await params;
    const featureKey = request.nextUrl.searchParams.get("featureKey");

    if (!featureKey) {
        return NextResponse.json({ error: "featureKey is required" }, { status: 400 });
    }

    const plan = await db.catalogPlan.findFirst({
        where: { id, teamId: auth.team.teamId },
    });
    if (!plan) {
        return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }

    const existing = getEntitlements(plan.metadata);
    const filtered = existing.filter((e) => e.featureKey !== featureKey);

    if (filtered.length === existing.length) {
        return NextResponse.json({ error: "Entitlement not found" }, { status: 404 });
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
        request,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: auth.team.walletAddress,
        action: "catalog.plan.entitlement.remove",
        resourceType: "CatalogPlan",
        resourceId: plan.id,
        afterData: { featureKey },
    });

    return NextResponse.json({ entitlements: filtered });
}
