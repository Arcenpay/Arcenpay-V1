// ============================================================
//  Dashboard API — Platform Tier Info & Upgrade
//
//  GET  /api/platform/tier  → Current tier info + usage
//  POST /api/platform/tier  → Upgrade/downgrade tier
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { getTeamTierInfo, getTierLimits, TIER_PRICING, TIER_FEATURES } from "@/lib/tier-guard";
import { writeAuditEvent } from "@/lib/audit";
import { PlatformTier } from "@/src/generated/prisma/client";

// ── GET: Retrieve current tier info + feature comparison ─────────────────────

export async function GET() {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const team = await resolveTeamContext(session);
    if (!team) {
        return NextResponse.json({ error: "No team found" }, { status: 403 });
    }

    const tierInfo = await getTeamTierInfo(team.teamId);
    if (!tierInfo) {
        return NextResponse.json(
            { error: "Team not found" },
            { status: 404 },
        );
    }

    // Get all tier configs for comparison table
    const allTiers = await Promise.all(
        (["FREE", "PLUS", "PRO"] as PlatformTier[]).map(async (tier) => ({
            tier,
            limits: await getTierLimits(tier),
            pricing: TIER_PRICING[tier],
            features: TIER_FEATURES[tier],
        })),
    );

    return NextResponse.json({
        current: tierInfo,
        allTiers,
    });
}

// ── POST: Upgrade or downgrade platform tier ─────────────────────────────────

const upgradeSchema = z.object({
    targetTier: z.enum(["FREE", "PLUS", "PRO"]),
    // On-chain transaction hash for the tier subscription payment
    // Required for upgrades to PLUS/PRO
    txHash: z.string().optional(),
});

export async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const team = await resolveTeamContext(session);
    if (!team) {
        return NextResponse.json({ error: "No team found" }, { status: 403 });
    }

    // Only OWNER can change tier
    if (team.teamRole !== "OWNER") {
        return NextResponse.json(
            { error: "Only workspace owners can change the platform tier" },
            { status: 403 },
        );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = upgradeSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
            { status: 400 },
        );
    }

    const { targetTier, txHash } = parsed.data;

    // Get current team
    const currentTeam = await db.team.findUnique({
        where: { id: team.teamId },
        select: { platformTier: true },
    });
    if (!currentTeam) {
        return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Prevent no-op
    if (currentTeam.platformTier === targetTier) {
        return NextResponse.json(
            { error: "Already on this tier" },
            { status: 400 },
        );
    }

    // Determine tier hierarchy for upgrade vs downgrade
    const tierOrder: Record<PlatformTier, number> = { FREE: 0, PLUS: 1, PRO: 2 };
    const isUpgrade = tierOrder[targetTier] > tierOrder[currentTeam.platformTier];

    // For upgrades to paid tiers, require a txHash (on-chain payment proof)
    if (isUpgrade && targetTier !== "FREE" && !txHash) {
        return NextResponse.json(
            {
                error: "Payment required",
                message: "Please complete the on-chain subscription payment first.",
                targetTier,
                pricing: TIER_PRICING,
            },
            { status: 402 },
        );
    }

    // For downgrades, check if current usage exceeds target tier limits
    if (!isUpgrade) {
        const targetLimits = await getTierLimits(targetTier);
        const planCount = await db.catalogPlan.count({
            where: { teamId: team.teamId, active: true },
        });
        const memberCount = await db.teamMember.count({
            where: { teamId: team.teamId },
        });

        const violations: string[] = [];
        if (planCount > targetLimits.maxPlans) {
            violations.push(
                `You have ${planCount} active plans but ${targetTier} allows ${targetLimits.maxPlans}`,
            );
        }
        if (memberCount > targetLimits.maxTeamMembers) {
            violations.push(
                `You have ${memberCount} team members but ${targetTier} allows ${targetLimits.maxTeamMembers}`,
            );
        }

        if (violations.length > 0) {
            return NextResponse.json(
                {
                    error: "Cannot downgrade",
                    message:
                        "Please reduce your usage below the target tier limits before downgrading.",
                    violations,
                },
                { status: 409 },
            );
        }
    }

    // Calculate expiry (30 days for paid tiers)
    const tierExpiresAt =
        targetTier === "FREE"
            ? null
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Apply tier change + record history
    const [updated] = await db.$transaction([
        db.team.update({
            where: { id: team.teamId },
            data: {
                platformTier: targetTier,
                tierExpiresAt,
                ...(txHash ? { tierSubscriptionId: txHash } : {}),
            },
            select: {
                id: true,
                platformTier: true,
                tierExpiresAt: true,
                tierSubscriptionId: true,
            },
        }),
        db.tierUpgradeHistory.create({
            data: {
                teamId: team.teamId,
                fromTier: currentTeam.platformTier,
                toTier: targetTier,
                txHash: txHash ?? null,
                amountUsd: isUpgrade ? TIER_PRICING[targetTier].priceUsdc : null,
                userId: team.userId,
            },
        }),
    ]);

    await writeAuditEvent({
        request,
        teamId: team.teamId,
        userId: team.userId,
        walletAddress: team.walletAddress,
        action: isUpgrade ? "platform.tier.upgrade" : "platform.tier.downgrade",
        resourceType: "Team",
        resourceId: team.teamId,
        beforeData: { tier: currentTeam.platformTier },
        afterData: { tier: targetTier, txHash },
    });

    return NextResponse.json({
        ok: true,
        team: updated,
        message: isUpgrade
            ? `Successfully upgraded to ${targetTier} tier!`
            : `Downgraded to ${targetTier} tier.`,
    });
}
