import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { getTeamTierInfo, getTierLimits, TIER_PRICING, TIER_FEATURES } from "../../../lib/catalog/tier-guard.js";
import { activateTeamPlatformTier, cancelTeamPlatformTier } from "../../../lib/billing/platform-tier-billing.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import type { PlatformTier } from "../../../generated/client/client.js";

export async function getTier(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const tierInfo = await getTeamTierInfo(auth.team.teamId);
  if (!tierInfo) {
    return c.json({ error: "Team not found" }, 404 as any);
  }

  const allTiers = await Promise.all(
    (["FREE", "PLUS", "PRO"] as PlatformTier[]).map(async (tier) => ({
      tier,
      limits: await getTierLimits(tier),
      pricing: TIER_PRICING[tier],
      features: TIER_FEATURES[tier],
    })),
  );

  return c.json({
    current: tierInfo,
    allTiers,
  });
}

const upgradeSchema = z.object({
  targetTier: z.enum(["FREE", "PLUS", "PRO"]),
  walletAddress: z.string().optional(),
});

export async function postTier(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json().catch(() => ({}));
  const parsed = upgradeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const { targetTier, walletAddress } = parsed.data;

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

  if (!isUpgrade) {
    const targetLimits = await getTierLimits(targetTier as PlatformTier);
    const planCount = await db.catalogPlan.count({
      where: { teamId: auth.team.teamId, active: true },
    });
    const memberCount = await db.teamMember.count({
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

    if (violations.length > 0) {
      return c.json({
          error: "Cannot downgrade",
          message:
            "Please reduce your usage below the target tier limits before downgrading.",
          violations,
        }, 409 as any);
    }
  }

  const tierExpiresAt =
    targetTier === "FREE"
      ? null
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let billingResult: {
    subscriptionStateId: string | null;
    invoiceId: string | null;
    paymentId: string | null;
  } = { subscriptionStateId: null, invoiceId: null, paymentId: null };

  if (isUpgrade && targetTier !== "FREE") {
    const activation = await activateTeamPlatformTier({
      teamId: auth.team.teamId,
      targetTier: targetTier as PlatformTier,
      walletAddress: walletAddress ?? auth.team.walletAddress ?? undefined,
    });

    if (!activation.ok) {
      return c.json({
          error: "Activation failed",
          message: activation.error ?? "Could not activate platform tier subscription.",
        }, 500 as any);
    }

    billingResult = activation;
  }

  if (!isUpgrade && targetTier === "FREE") {
    await cancelTeamPlatformTier({ teamId: auth.team.teamId });
  }

  const updated = await db.team.update({
    where: { id: auth.team.teamId },
    data: {
      platformTier: targetTier as PlatformTier,
      tierExpiresAt,
      ...(billingResult.subscriptionStateId
        ? { tierSubscriptionId: billingResult.subscriptionStateId }
        : targetTier === "FREE"
          ? { tierSubscriptionId: null }
          : {}),
    },
    select: {
      id: true,
      platformTier: true,
      tierExpiresAt: true,
      tierSubscriptionId: true,
    },
  });

  await db.tierUpgradeHistory.create({
    data: {
      teamId: auth.team.teamId,
      fromTier: currentTeam.platformTier,
      toTier: targetTier as PlatformTier,
      txHash: null,
      amountUsd: isUpgrade ? TIER_PRICING[targetTier as PlatformTier].priceUsdc : null,
      userId: auth.team.userId,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: isUpgrade ? "platform.tier.upgrade" : "platform.tier.downgrade",
    resourceType: "Team",
    resourceId: auth.team.teamId,
    beforeData: { tier: currentTeam.platformTier },
    afterData: { tier: targetTier, billingResult },
  });

  return c.json({
    ok: true,
    team: updated,
    billing: billingResult,
    message: isUpgrade
      ? `Successfully upgraded to ${targetTier} tier!`
      : `Downgraded to ${targetTier} tier.`,
  });
}
