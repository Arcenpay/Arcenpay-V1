// ============================================================
//  Dashboard — Platform Tier Guards
//
//  Server-side enforcement of per-tier limits.
//  Call these from API routes before allowing resource creation.
// ============================================================

import { db } from "../../db.js";
import { PlatformTier } from "../../generated/client/client.js";

// ── Tier pricing (USD per month) ────────────────────────────────────────────

export const TIER_PRICING: Record<PlatformTier, { priceUsdc: number; interval: "monthly" }> = {
    FREE: { priceUsdc: 0, interval: "monthly" },
    PLUS: { priceUsdc: 29, interval: "monthly" },
    PRO: { priceUsdc: 99, interval: "monthly" },
};

// ── Feature flags per tier ──────────────────────────────────────────────────

export const TIER_FEATURES: Record<PlatformTier, {
    analytics: boolean;
    webhooks: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
    dedicatedSupport: boolean;
    managedPlanEditing: boolean;
    crossChainBilling: boolean;
    whiteGloveOnboarding: boolean;
}> = {
    FREE: {
        analytics: true,         // basic only
        webhooks: false,
        customBranding: false,
        apiAccess: false,
        prioritySupport: false,
        dedicatedSupport: false,
        managedPlanEditing: false,
        crossChainBilling: false,
        whiteGloveOnboarding: false,
    },
    PLUS: {
        analytics: true,
        webhooks: true,
        customBranding: true,
        apiAccess: true,
        prioritySupport: true,
        dedicatedSupport: false,
        managedPlanEditing: false,
        crossChainBilling: true,
        whiteGloveOnboarding: false,
    },
    PRO: {
        analytics: true,
        webhooks: true,
        customBranding: true,
        apiAccess: true,
        prioritySupport: true,
        dedicatedSupport: true,
        managedPlanEditing: true,
        crossChainBilling: true,
        whiteGloveOnboarding: true,
    },
};

// ── Default limits (used when PlatformTierConfig rows don't exist yet) ────────

const DEFAULT_LIMITS: Record<
    PlatformTier,
    {
        maxWorkspaces: number;
        maxPlans: number;
        maxSubscribers: number;
        maxTeamMembers: number;
        maxFeatureFlags: number;
        maxChains: number;
        platformFeeBps: number;
        gasDailyBudgetUsd: number;
    }
> = {
    FREE: {
        maxWorkspaces: 1,
        maxPlans: 2,
        maxSubscribers: 200,
        maxTeamMembers: 1,
        maxFeatureFlags: 5,
        maxChains: 1,
        platformFeeBps: 200, // 2.0% — unified fee (replaces stacked on-chain + off-chain)
        gasDailyBudgetUsd: 1.0,
    },
    PLUS: {
        maxWorkspaces: 3,
        maxPlans: 15,
        maxSubscribers: 50_000,
        maxTeamMembers: 10,
        maxFeatureFlags: 999,
        maxChains: 3,
        platformFeeBps: 100, // 1.0%
        gasDailyBudgetUsd: 10.0,
    },
    PRO: {
        maxWorkspaces: 999,
        maxPlans: 999,
        maxSubscribers: 999_999,
        maxTeamMembers: 999,
        maxFeatureFlags: 999,
        maxChains: 999,
        platformFeeBps: 50, // 0.5%
        gasDailyBudgetUsd: 100.0,
    },
};

export type TierLimits = (typeof DEFAULT_LIMITS)[PlatformTier];

// ── Resolve limits (DB row > in-memory defaults) ─────────────────────────────

export async function getTierLimits(tier: PlatformTier): Promise<TierLimits> {
    const row = await db.platformTierConfig.findUnique({ where: { tier } });
    if (!row) return DEFAULT_LIMITS[tier];
    return {
        maxWorkspaces: row.maxWorkspaces,
        maxPlans: row.maxPlans,
        maxSubscribers: row.maxSubscribers,
        maxTeamMembers: row.maxTeamMembers,
        maxFeatureFlags: row.maxFeatureFlags,
        maxChains: row.maxChains,
        platformFeeBps: row.platformFeeBps,
        gasDailyBudgetUsd: Number(row.gasDailyBudgetUsd),
    };
}

// ── Guard: workspace creation ────────────────────────────────────────────────

export type TierGuardResult =
    | { allowed: true }
    | { allowed: false; reason: string; limit: number; current: number; upgradeRequired: PlatformTier };

/**
 * Checks whether the user can create a new workspace (Team).
 * Free tier users are limited to 1 workspace.
 */
export async function assertCanCreateWorkspace(
    userId: string,
): Promise<TierGuardResult> {
    // Count how many teams this user already owns
    const ownedTeams = await db.teamMember.count({
        where: { userId, role: "OWNER" },
    });

    // Get the tier of their first team (if any) — for users with no teams, allow creation
    if (ownedTeams === 0) return { allowed: true };

    const firstMembership = await db.teamMember.findFirst({
        where: { userId, role: "OWNER" },
        include: { team: { select: { platformTier: true } } },
        orderBy: { createdAt: "asc" },
    });

    const tier = firstMembership?.team.platformTier ?? "FREE";
    const limits = await getTierLimits(tier);

    if (ownedTeams >= limits.maxWorkspaces) {
        const nextTier = tier === "FREE" ? "PLUS" : "PRO";
        return {
            allowed: false,
            reason: `Your ${tier} plan allows a maximum of ${limits.maxWorkspaces} workspace(s).`,
            limit: limits.maxWorkspaces,
            current: ownedTeams,
            upgradeRequired: nextTier as PlatformTier,
        };
    }

    return { allowed: true };
}

// ── Guard: plan creation ─────────────────────────────────────────────────────

/**
 * Checks whether the team can create a new catalog plan.
 */
export async function assertCanCreatePlan(
    teamId: string,
): Promise<TierGuardResult> {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });
    if (!team) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(team.platformTier);
    const planCount = await db.catalogPlan.count({
        where: { teamId, active: true },
    });

    if (planCount >= limits.maxPlans) {
        const nextTier = team.platformTier === "FREE" ? "PLUS" : "PRO";
        return {
            allowed: false,
            reason: `Your ${team.platformTier} plan allows a maximum of ${limits.maxPlans} plan(s).`,
            limit: limits.maxPlans,
            current: planCount,
            upgradeRequired: nextTier as PlatformTier,
        };
    }

    return { allowed: true };
}

// ── Guard: team member invite ────────────────────────────────────────────────

/**
 * Checks whether the team can invite another member.
 */
export async function assertCanInviteMember(
    teamId: string,
): Promise<TierGuardResult> {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });
    if (!team) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(team.platformTier);
    const memberCount = await db.teamMember.count({ where: { teamId } });

    if (memberCount >= limits.maxTeamMembers) {
        const nextTier = team.platformTier === "FREE" ? "PLUS" : "PRO";
        return {
            allowed: false,
            reason: `Your ${team.platformTier} plan allows a maximum of ${limits.maxTeamMembers} team member(s).`,
            limit: limits.maxTeamMembers,
            current: memberCount,
            upgradeRequired: nextTier as PlatformTier,
        };
    }

    return { allowed: true };
}

// ── Helper: get fee rate for a team ──────────────────────────────────────────

/**
 * Returns the platform fee rate (in basis points) for the given team's tier.
 */
export async function getTeamFeeBps(teamId: string): Promise<number> {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });
    if (!team) return DEFAULT_LIMITS.FREE.platformFeeBps;

    const limits = await getTierLimits(team.platformTier);
    return limits.platformFeeBps;
}

/**
 * Returns the current team's tier info for display in the dashboard.
 */
export async function getTeamTierInfo(teamId: string) {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true, tierExpiresAt: true, tierSubscriptionId: true },
    });
    if (!team) return null;

    const limits = await getTierLimits(team.platformTier);
    const planCount = await db.catalogPlan.count({ where: { teamId, active: true } });
    const memberCount = await db.teamMember.count({ where: { teamId } });

    return {
        tier: team.platformTier,
        expiresAt: team.tierExpiresAt,
        subscriptionId: team.tierSubscriptionId,
        limits,
        usage: {
            plans: planCount,
            members: memberCount,
        },
    };
}
