import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import {
  getTeamTierInfo,
  getTierLimits,
  TIER_PRICING,
  TIER_FEATURES,
} from "../../../lib/catalog/tier-guard.js";
import {
  cancelTeamPlatformTier,
  getTeamPlatformBillingReadiness,
  getTeamPlatformSubscription,
} from "../../../lib/billing/platform-tier-billing.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import type { PlatformTier } from "../../../generated/client/client.js";

/**
 * GET /api/v1/platform/tier
 *
 * Returns the team's current tier, all tier options (limits + pricing + features),
 * billing readiness (bootstrap status), platform plan on-chain data, and
 * the team's active subscription status.
 */
export async function getTier(c: Context) {
  const auth = await requireTeamRoles(c, [
    "OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER",
  ]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const tierInfo = await getTeamTierInfo(auth.team.teamId);
  if (!tierInfo) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const [allTiers, readinessResult, subscription] = await Promise.all([
    Promise.all(
      (["FREE", "PLUS", "PRO"] as PlatformTier[]).map(async (tier) => ({
        tier,
        limits: await getTierLimits(tier),
        pricing: TIER_PRICING[tier],
        features: TIER_FEATURES[tier],
      })),
    ),
    getTeamPlatformBillingReadiness(auth.team.teamId),
    getTeamPlatformSubscription(auth.team.teamId),
  ]);

  return c.json({
    current: tierInfo,
    allTiers,
    billingReadiness: readinessResult.readiness,
    platformPlans: readinessResult.platformPlans,
    subscription: subscription
      ? {
          status: subscription.status,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          pastDueAt: subscription.pastDueAt,
          graceEndsAt: subscription.graceEndsAt,
          tier: subscription.tier,
          amount: subscription.amountMicros,
        }
      : null,
  });
}

const downgradeSchema = z.object({
  targetTier: z.enum(["FREE", "PLUS", "PRO"]),
});

/**
 * POST /api/v1/platform/tier
 *
 * Handles DOWNGRADE to FREE only.
 *
 * Paid upgrades (FREE → PLUS, FREE → PRO, PLUS → PRO) MUST use the
 * /platform/tier/prepare + /platform/tier/confirm flow to ensure
 * on-chain transaction verification. This endpoint will return 422
 * for any paid upgrade attempt.
 */
export async function postTier(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const body = await c.req.json().catch(() => ({}));
  const parsed = downgradeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid request", details: parsed.error.flatten().fieldErrors },
      400 as any,
    );
  }

  const { targetTier } = parsed.data;

  const currentTeam = await db.team.findUnique({
    where: { id: auth.team.teamId },
    select: { platformTier: true },
  });
  if (!currentTeam) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  if (currentTeam.platformTier === targetTier) {
    return c.json({ error: "Already on this tier" }, 400 as any);
  }

  const tierOrder: Record<string, number> = { FREE: 0, PLUS: 1, PRO: 2 };
  const isUpgrade = tierOrder[targetTier] > tierOrder[currentTeam.platformTier];

  // Block paid upgrades — they must use the on-chain verify flow
  if (isUpgrade && targetTier !== "FREE") {
    return c.json(
      {
        error: "UPGRADE_REQUIRES_ONCHAIN_TX",
        message:
          "Paid tier upgrades require on-chain transaction verification. " +
          "Use POST /platform/tier/prepare to get transaction data, submit the " +
          "transactions to your wallet, then POST /platform/tier/confirm with the txHash.",
        requiredFlow: {
          step1: "POST /api/platform/tier/prepare — get encoded tx data",
          step2: "Submit install, approve, and execute transactions to your wallet",
          step3: "POST /api/platform/tier/confirm — verify tx and activate tier",
        },
      },
      422 as any,
    );
  }

  // Downgrade: enforce limit checks
  if (!isUpgrade) {
    const targetLimits = await getTierLimits(targetTier as PlatformTier);
    const planCount = await db.catalogPlan.count({
      where: { teamId: auth.team.teamId, active: true },
    });
    const memberCount = await db.teamMember.count({
      where: { teamId: auth.team.teamId },
    });
    const addOnCount = await db.catalogAddOn.count({
      where: { teamId: auth.team.teamId, active: true },
    });
    const creditCount = await db.catalogCreditType.count({
      where: { teamId: auth.team.teamId, active: true },
    });
    const paymentLinkCount = await db.paymentLink.count({
      where: { teamId: auth.team.teamId, status: "ACTIVE" },
    });
    const flagCount = await db.catalogFeatureFlag.count({
      where: { teamId: auth.team.teamId },
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
    if (addOnCount > targetLimits.maxAddOns) {
      violations.push(
        `You have ${addOnCount} active add-ons but ${targetTier} allows ${targetLimits.maxAddOns}`,
      );
    }
    if (creditCount > targetLimits.maxCreditTypes) {
      violations.push(
        `You have ${creditCount} active credit types but ${targetTier} allows ${targetLimits.maxCreditTypes}`,
      );
    }
    if (paymentLinkCount > targetLimits.maxPaymentLinks) {
      violations.push(
        `You have ${paymentLinkCount} active payment links but ${targetTier} allows ${targetLimits.maxPaymentLinks}`,
      );
    }
    if (flagCount > targetLimits.maxFeatureFlags) {
      violations.push(
        `You have ${flagCount} feature flags but ${targetTier} allows ${targetLimits.maxFeatureFlags}`,
      );
    }
    const apiKeyCount = await db.arcenApiKey.count({
      where: { teamId: auth.team.teamId },
    });
    if (apiKeyCount > targetLimits.maxApiKeys) {
      violations.push(
        `You have ${apiKeyCount} API keys but ${targetTier} allows ${targetLimits.maxApiKeys}`,
      );
    }
    const webhookEnvCount = await db.providerProfile.count({
      where: { teamId: auth.team.teamId, webhookUrl: { not: null } },
    });
    if (webhookEnvCount > targetLimits.maxWebhooks) {
      violations.push(
        `You have ${webhookEnvCount} webhook endpoints but ${targetTier} allows ${targetLimits.maxWebhooks}`,
      );
    }
    const couponCount = await db.catalogCoupon.count({
      where: { teamId: auth.team.teamId, active: true },
    });
    if (couponCount > targetLimits.maxCoupons) {
      violations.push(
        `You have ${couponCount} active coupons but ${targetTier} allows ${targetLimits.maxCoupons}`,
      );
    }
    const subscriberCount = await db.arcenCompany.count({
      where: { teamId: auth.team.teamId },
    });
    if (subscriberCount > targetLimits.maxSubscribers) {
      violations.push(
        `You have ${subscriberCount} subscribers but ${targetTier} allows ${targetLimits.maxSubscribers}`,
      );
    }
    const devEnvCount = await db.workspaceEnvironment.count({
      where: { teamId: auth.team.teamId, mode: "DEVELOPMENT" },
    });
    if (devEnvCount > targetLimits.maxDevelopmentEnvironments) {
      violations.push(
        `You have ${devEnvCount} development environments but ${targetTier} allows ${targetLimits.maxDevelopmentEnvironments}`,
      );
    }
    const prodEnvCount = await db.workspaceEnvironment.count({
      where: { teamId: auth.team.teamId, mode: "PRODUCTION" },
    });
    if (prodEnvCount > targetLimits.maxProductionEnvironments) {
      violations.push(
        `You have ${prodEnvCount} production environments but ${targetTier} allows ${targetLimits.maxProductionEnvironments}`,
      );
    }

    if (violations.length > 0) {
      return c.json(
        {
          error: "Cannot downgrade",
          message:
            "Please reduce your usage below the target tier limits before downgrading.",
          violations,
        },
        409 as any,
      );
    }

    // Perform the cancellation
    await cancelTeamPlatformTier({ teamId: auth.team.teamId });
  }

  const updated = await db.team.update({
    where: { id: auth.team.teamId },
    data: {
      platformTier: targetTier as PlatformTier,
      tierExpiresAt: null,
      tierSubscriptionId: targetTier === "FREE" ? null : undefined,
    },
    select: { id: true, platformTier: true, tierExpiresAt: true, tierSubscriptionId: true },
  });

  await db.tierUpgradeHistory.create({
    data: {
      teamId: auth.team.teamId,
      fromTier: currentTeam.platformTier,
      toTier: targetTier as PlatformTier,
      txHash: null,
      amountUsd: null,
      userId: auth.team.userId,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "platform.tier.downgrade",
    resourceType: "Team",
    resourceId: auth.team.teamId,
    beforeData: { tier: currentTeam.platformTier },
    afterData: { tier: targetTier },
  });

  return c.json({
    ok: true,
    team: updated,
    message: `Downgraded to ${targetTier} tier.`,
  });
}
