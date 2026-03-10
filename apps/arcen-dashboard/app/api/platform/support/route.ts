// ============================================================
//  Dashboard API — Pro Support Tickets
//
//  GET  /api/platform/support  → List team's support tickets
//  POST /api/platform/support  → Create a new support ticket (Pro only)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requirePermission, isErrorResponse } from "@/lib/api-auth";
import { writeAuditEvent } from "@/lib/audit";
import { TIER_FEATURES } from "@/lib/tier-guard";
import { PlatformTier } from "@/src/generated/prisma/client";

// ── GET: List support tickets ────────────────────────────────────────────────

export async function GET(request: NextRequest) {
    const auth = await requirePermission("catalog:read");
    if (isErrorResponse(auth)) return auth;

    const statusFilter = request.nextUrl.searchParams.get("status");

    const tickets = await db.supportTicket.findMany({
        where: {
            teamId: auth.team.teamId,
            ...(statusFilter ? { status: statusFilter as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
    });

    return NextResponse.json({ tickets });
}

// ── POST: Create support ticket ──────────────────────────────────────────────

const createSchema = z.object({
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    category: z.enum([
        "plan-editing",
        "billing",
        "technical",
        "account",
        "feature-request",
        "other",
    ]).optional(),
});

export async function POST(request: NextRequest) {
    const auth = await requirePermission("catalog:write");
    if (isErrorResponse(auth)) return auth;

    // Check team tier — only PLUS (priority) and PRO (dedicated) can create tickets
    const team = await db.team.findUnique({
        where: { id: auth.team.teamId },
        select: { platformTier: true },
    });
    if (!team) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const tier = team.platformTier as PlatformTier;
    const features = TIER_FEATURES[tier];

    if (!features.prioritySupport && !features.dedicatedSupport) {
        return NextResponse.json(
            {
                error: "Support tickets require PLUS or PRO tier",
                upgradeRequired: "PLUS",
                message: "Upgrade to PLUS for priority email support, or PRO for dedicated support with managed plan editing.",
            },
            { status: 403 },
        );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    // Pro users get HIGH priority by default, PLUS users get NORMAL
    const priority = features.dedicatedSupport ? "HIGH" : "NORMAL";

    const ticket = await db.supportTicket.create({
        data: {
            teamId: auth.team.teamId,
            userId: auth.team.userId,
            subject: parsed.data.subject,
            body: parsed.data.body,
            category: parsed.data.category ?? null,
            priority: priority as never,
        },
    });

    await writeAuditEvent({
        request,
        teamId: auth.team.teamId,
        userId: auth.team.userId,
        walletAddress: auth.team.walletAddress,
        action: "support.ticket.create",
        resourceType: "SupportTicket",
        resourceId: ticket.id,
        afterData: ticket,
    });

    return NextResponse.json({ ticket }, { status: 201 });
}
