import type { Context } from "hono";
import {
  getTeamTierInfo,
  getTierLimits,
  TIER_PRICING,
  TIER_FEATURES,
} from "../../../lib/catalog/tier-guard.js";
import {
  getTeamPlatformBillingReadiness,
  getTeamPlatformSubscription,
} from "../../../lib/billing/platform-tier-billing.js";
import { getPlatformBillingStatus } from "../../../lib/billing/platform-enrollment.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { PLATFORM_OWNER_WALLET } from "../../../lib/auth/platform-owner.js";
import type { PlatformTier } from "../../../generated/client/client.js";

export async function getTier(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const tierInfo = await getTeamTierInfo(auth.team.teamId);
  if (!tierInfo) return c.json({ error: "Team not found" }, 404 as any);

  const [allTiers, readinessResult, enrollment, platformSubscription] = await Promise.all([
    Promise.all(([
      "FREE",
      "PLUS",
      "PRO",
    ] as PlatformTier[]).map(async (tier) => ({
      tier,
      limits: await getTierLimits(tier),
      pricing: TIER_PRICING[tier],
      features: TIER_FEATURES[tier],
    }))),
    getTeamPlatformBillingReadiness(auth.team.teamId),
    getPlatformBillingStatus(auth.team.teamId),
    getTeamPlatformSubscription(auth.team.teamId),
  ]);

  // PlatformBillingPlan rows describe ArcenPay's own first-party catalog.
  // They are not provider catalog data and must not be exposed through the
  // normal workspace tier endpoint. Bootstrap remains available only through
  // the owner-gated /tier/bootstrap route.
  return c.json({
    current: tierInfo,
    allTiers,
    billingReadiness: readinessResult.readiness,
    canBootstrapPlatformPlans:
      auth.team.walletAddress?.trim().toLowerCase() === PLATFORM_OWNER_WALLET,
    enrollment,
    subscription: platformSubscription,
  });
}

export async function postTier(c: Context) {
  c.header("Deprecation", "true");
  c.header("Sunset", "2026-12-31");
  return c.json({
    ok: false,
    error: "PLATFORM_TIER_FLOW_DEPRECATED",
    message: "Manage platform plan changes from the enrolled billing portal.",
  }, 410 as any);
}
