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
    PLUS: { priceUsdc: 9.99, interval: "monthly" },
    PRO: { priceUsdc: 499, interval: "monthly" },
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
    agentPayments: boolean;
    zkSettlement: boolean;
    crossChainMirroring: boolean;
    tableland: boolean;
    litProtocol: boolean;
}> = {
    FREE: {
        analytics: true,
        webhooks: true,
        customBranding: false,
        apiAccess: true,
        prioritySupport: false,
        dedicatedSupport: false,
        managedPlanEditing: false,
        crossChainBilling: false,
        whiteGloveOnboarding: false,
        agentPayments: true,
        zkSettlement: true,
        crossChainMirroring: false,
        tableland: false,
        litProtocol: false,
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
        agentPayments: true,
        zkSettlement: true,
        crossChainMirroring: false,
        tableland: false,
        litProtocol: false,
    },
    PRO: {
        analytics: true,
        webhooks: true,
        customBranding: true,
        apiAccess: true,
        prioritySupport: true,
        dedicatedSupport: true,
        managedPlanEditing: false,
        crossChainBilling: true,
        whiteGloveOnboarding: false,
        agentPayments: true,
        zkSettlement: true,
        crossChainMirroring: false,
        tableland: false,
        litProtocol: false,
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
        maxDevelopmentEnvironments: number;
        maxProductionEnvironments: number;
        maxAddOns: number;
        maxCreditTypes: number;
        maxPaymentLinks: number;
        maxApiKeys: number;
        maxWebhooks: number;
        maxCoupons: number;
        maxCheckoutSessionsPerMonth: number;
        platformFeeBps: number;
        gasDailyBudgetUsd: number;
    }
> = {
    FREE: {
        maxWorkspaces: 1,
        maxPlans: 3,
        maxSubscribers: 200,
        maxTeamMembers: 3,
        maxFeatureFlags: 5,
        maxChains: 1,
        maxDevelopmentEnvironments: 2,
        maxProductionEnvironments: 2,
        maxAddOns: 0,
        maxCreditTypes: 0,
        maxPaymentLinks: 3,
        maxApiKeys: 1,
        maxWebhooks: 1,
        maxCoupons: 0,
        maxCheckoutSessionsPerMonth: 999_999,
        platformFeeBps: 200,
        gasDailyBudgetUsd: 1.0,
    },
    PLUS: {
        maxWorkspaces: 10,
        maxPlans: 15,
        maxSubscribers: 50_000,
        maxTeamMembers: 10,
        maxFeatureFlags: 999,
        maxChains: 999,
        maxDevelopmentEnvironments: 10,
        maxProductionEnvironments: 10,
        maxAddOns: 10,
        maxCreditTypes: 5,
        maxPaymentLinks: 50,
        maxApiKeys: 999,
        maxWebhooks: 999,
        maxCoupons: 10,
        maxCheckoutSessionsPerMonth: 999_999,
        platformFeeBps: 100,
        gasDailyBudgetUsd: 10.0,
    },
    PRO: {
        maxWorkspaces: 999,
        maxPlans: 999,
        maxSubscribers: 999_999,
        maxTeamMembers: 999,
        maxFeatureFlags: 999,
        maxChains: 999,
        maxDevelopmentEnvironments: 999,
        maxProductionEnvironments: 999,
        maxAddOns: 999_999,
        maxCreditTypes: 999_999,
        maxPaymentLinks: 999_999,
        maxApiKeys: 999_999,
        maxWebhooks: 999_999,
        maxCoupons: 999_999,
        maxCheckoutSessionsPerMonth: 999_999,
        platformFeeBps: 50,
        gasDailyBudgetUsd: 100.0,
    },
};

export type TierLimits = (typeof DEFAULT_LIMITS)[PlatformTier];

// ── Resolve limits (DB row > in-memory defaults) ─────────────────────────────

export async function getTierLimits(tier: PlatformTier): Promise<TierLimits> {
    const limits = DEFAULT_LIMITS[tier];
    
    try {
        await db.platformTierConfig.upsert({
            where: { tier },
            update: {
                maxWorkspaces: limits.maxWorkspaces,
                maxPlans: limits.maxPlans,
                maxSubscribers: limits.maxSubscribers,
                maxTeamMembers: limits.maxTeamMembers,
                maxFeatureFlags: limits.maxFeatureFlags,
                maxChains: limits.maxChains,
                maxDevelopmentEnvironments: limits.maxDevelopmentEnvironments,
                maxProductionEnvironments: limits.maxProductionEnvironments,
                platformFeeBps: limits.platformFeeBps,
            },
            create: {
                tier,
                maxWorkspaces: limits.maxWorkspaces,
                maxPlans: limits.maxPlans,
                maxSubscribers: limits.maxSubscribers,
                maxTeamMembers: limits.maxTeamMembers,
                maxFeatureFlags: limits.maxFeatureFlags,
                maxChains: limits.maxChains,
                maxDevelopmentEnvironments: limits.maxDevelopmentEnvironments,
                maxProductionEnvironments: limits.maxProductionEnvironments,
                platformFeeBps: limits.platformFeeBps,
                gasSponsored: tier !== "FREE",
                gasDailyBudgetUsd: limits.gasDailyBudgetUsd,
            }
        });
    } catch {
        // Safe fallback if database isn't fully migrated or ready
    }

    return limits;
}

// ── Get current tier of a team ──────────────────────────────────────────────

async function getTeamTier(teamId: string): Promise<PlatformTier | null> {
    const team = await db.team.findUnique({
        where: { id: teamId },
        select: { platformTier: true },
    });
    return team?.platformTier ?? null;
}

// ── Guard result type ───────────────────────────────────────────────────────

export type TierGuardResult =
    | { allowed: true }
    | { allowed: false; reason: string; limit: number; current: number; upgradeRequired: PlatformTier };

function nextTier(tier: PlatformTier): PlatformTier {
    return tier === "FREE" ? "PLUS" : "PRO" as PlatformTier;
}

// ── Guard: workspace creation ────────────────────────────────────────────────

/**
 * Checks whether the user can create a new workspace (Team).
 * Free tier users are limited to 1 workspace.
 */
export async function assertCanCreateWorkspace(
    userId: string,
): Promise<TierGuardResult> {
    const ownedTeams = await db.teamMember.count({
        where: { userId, role: "OWNER" },
    });

    if (ownedTeams === 0) return { allowed: true };

    const firstMembership = await db.teamMember.findFirst({
        where: { userId, role: "OWNER" },
        include: { team: { select: { platformTier: true } } },
        orderBy: { createdAt: "asc" },
    });

    const tier = firstMembership?.team.platformTier ?? "FREE";
    const limits = await getTierLimits(tier);

    if (ownedTeams >= limits.maxWorkspaces) {
        return {
            allowed: false,
            reason: `Your ${tier} plan allows a maximum of ${limits.maxWorkspaces} workspace(s). Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxWorkspaces,
            current: ownedTeams,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: plan creation ─────────────────────────────────────────────────────

export async function assertCanCreatePlan(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);
    const plans = await db.catalogPlan.findMany({
        where: { teamId, active: true },
        select: { metadata: true }
    });
    const planCount = plans.filter(p => {
        const meta = p.metadata ? (p.metadata as Record<string, any>) : {};
        return !meta.isPlatformTierPlan;
    }).length;

    if (planCount >= limits.maxPlans) {
        return {
            allowed: false,
            reason: `Your ${tier} plan allows a maximum of ${limits.maxPlans} plan(s). Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxPlans,
            current: planCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: team member invite ────────────────────────────────────────────────

export async function assertCanInviteMember(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);
    const memberCount = await db.teamMember.count({ where: { teamId } });

    if (memberCount >= limits.maxTeamMembers) {
        return {
            allowed: false,
            reason: `Your ${tier} plan allows a maximum of ${limits.maxTeamMembers} team member(s). Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxTeamMembers,
            current: memberCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: add-on creation ──────────────────────────────────────────────────

export async function assertCanCreateAddOn(
    teamId: string,
    environmentId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);

    if (limits.maxAddOns === 0) {
        return {
            allowed: false,
            reason: "Add-ons are not supported on the Free plan. Upgrade to Growth or Enterprise to create add-ons.",
            limit: 0,
            current: 0,
            upgradeRequired: "PLUS" as PlatformTier,
        };
    }

    const currentCount = await db.catalogAddOn.count({
        where: { teamId, environmentId, active: true },
    });

    if (currentCount >= limits.maxAddOns) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxAddOns} add-on(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxAddOns,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: credit type creation ─────────────────────────────────────────────

export async function assertCanCreateCreditType(
    teamId: string,
    environmentId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);

    if (limits.maxCreditTypes === 0) {
        return {
            allowed: false,
            reason: "Credit Types are not supported on the Free plan. Upgrade to Growth or Enterprise to create credit types.",
            limit: 0,
            current: 0,
            upgradeRequired: "PLUS" as PlatformTier,
        };
    }

    const currentCount = await db.catalogCreditType.count({
        where: { teamId, environmentId, active: true },
    });

    if (currentCount >= limits.maxCreditTypes) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxCreditTypes} credit type(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxCreditTypes,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: payment link creation ────────────────────────────────────────────

export async function assertCanCreatePaymentLink(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);
    const currentCount = await db.paymentLink.count({
        where: { teamId, status: "ACTIVE" },
    });

    if (currentCount >= limits.maxPaymentLinks) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxPaymentLinks} active payment link(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxPaymentLinks,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: API key creation ─────────────────────────────────────────────────

export async function assertCanCreateApiKey(
    teamId: string,
    environmentId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);
    const currentCount = await db.arcenApiKey.count({
        where: { teamId, environmentId },
    });

    if (currentCount >= limits.maxApiKeys) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxApiKeys} API key(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxApiKeys,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: coupon creation ──────────────────────────────────────────────────

export async function assertCanCreateCoupon(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);

    if (limits.maxCoupons === 0) {
        return {
            allowed: false,
            reason: "Coupons are not supported on the Free plan. Upgrade to Growth or Enterprise to create coupons.",
            limit: 0,
            current: 0,
            upgradeRequired: "PLUS" as PlatformTier,
        };
    }

    const currentCount = await db.catalogCoupon.count({
        where: { teamId, active: true },
    });

    if (currentCount >= limits.maxCoupons) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxCoupons} active coupon(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxCoupons,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: subscriber creation ──────────────────────────────────────────────

export async function assertCanCreateSubscriber(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);
    const currentCount = await db.arcenCompany.count({ where: { teamId } });

    if (currentCount >= limits.maxSubscribers) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxSubscribers} subscriber(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxSubscribers,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: checkout session creation ────────────────────────────────────────

export async function assertCanCreateCheckoutSession(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const limits = await getTierLimits(tier);

    // Only enforce monthly cap for FREE tier
    if (tier !== "FREE") return { allowed: true };

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const currentCount = await db.checkoutSession.count({
        where: { teamId, createdAt: { gte: monthStart } },
    });

    if (currentCount >= limits.maxCheckoutSessionsPerMonth) {
        return {
            allowed: false,
            reason: `You have reached the monthly limit of ${limits.maxCheckoutSessionsPerMonth} checkout session(s) on the Free plan. Upgrade to Growth or Enterprise for unlimited sessions.`,
            limit: limits.maxCheckoutSessionsPerMonth,
            current: currentCount,
            upgradeRequired: "PLUS" as PlatformTier,
        };
    }

    return { allowed: true };
}

// ── Guard: webhook endpoint creation ────────────────────────────────────────

export async function assertCanCreateWebhook(
    teamId: string,
): Promise<TierGuardResult> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, reason: "Team not found", limit: 0, current: 0, upgradeRequired: "FREE" as PlatformTier };

    const features = TIER_FEATURES[tier];
    if (!features.webhooks) {
        return {
            allowed: false,
            reason: "Webhooks are not available on your current plan. Upgrade to at least Growth to enable webhooks.",
            limit: 0,
            current: 0,
            upgradeRequired: "PLUS" as PlatformTier,
        };
    }

    const limits = await getTierLimits(tier);
    // Count provider profiles with webhook URLs set
    const currentCount = await db.providerProfile.count({
        where: { teamId, webhookUrl: { not: null } },
    });

    if (currentCount >= limits.maxWebhooks) {
        return {
            allowed: false,
            reason: `You have reached the limit of ${limits.maxWebhooks} webhook endpoint(s) for your ${tier} plan. Upgrade to ${nextTier(tier)} for more.`,
            limit: limits.maxWebhooks,
            current: currentCount,
            upgradeRequired: nextTier(tier),
        };
    }

    return { allowed: true };
}

// ── Guard: billing features per tier ────────────────────────────────────────

/** Check if a boolean feature is available for a team's tier. */
export async function assertTierFeature(
    teamId: string,
    feature: keyof typeof TIER_FEATURES.FREE,
): Promise<{ allowed: boolean; upgradeRequired: PlatformTier }> {
    const tier = await getTeamTier(teamId);
    if (!tier) return { allowed: false, upgradeRequired: "PLUS" as PlatformTier };

    const features = TIER_FEATURES[tier];
    if (features[feature]) return { allowed: true, upgradeRequired: tier };

    const upgradeTier = tier === "FREE" ? "PLUS" : "PRO" as PlatformTier;
    return { allowed: false, upgradeRequired: upgradeTier };
}

// ── Helper: get fee rate for a team ──────────────────────────────────────────

export async function getTeamFeeBps(teamId: string): Promise<number> {
    const tier = await getTeamTier(teamId);
    if (!tier) return DEFAULT_LIMITS.FREE.platformFeeBps;

    const limits = await getTierLimits(tier);
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

    const tier = team.platformTier;
    const [limits, features] = await Promise.all([
        getTierLimits(tier),
        Promise.resolve(TIER_FEATURES[tier]),
    ]);

    const plans = await db.catalogPlan.findMany({
        where: { teamId, active: true },
        select: { metadata: true }
    });
    const planCount = plans.filter(p => {
        const meta = p.metadata ? (p.metadata as Record<string, any>) : {};
        return !meta.isPlatformTierPlan;
    }).length;

    const memberCount = await db.teamMember.count({ where: { teamId } });

    return {
        tier,
        expiresAt: team.tierExpiresAt,
        subscriptionId: team.tierSubscriptionId,
        limits,
        features,
        usage: {
            plans: planCount,
            members: memberCount,
        },
    };
}
