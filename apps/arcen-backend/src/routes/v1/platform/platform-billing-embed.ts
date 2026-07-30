import type { Context } from "hono";
import { createHash, randomBytes, createHmac } from "node:crypto";
import { db } from "../../../db.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import { toPrismaJson } from "../../../utils/prisma-json.js";
import {
  ensurePlatformSubscriptionCompany,
  ensureTierCatalogPlan,
  buildPlatformTierEntitlements,
} from "../../../lib/billing/platform-tier-billing.js";
import { PLATFORM_BILLING_CHAIN_ID } from "../../../config.js";
import { syncEntitlementsToFlagRules } from "../../../lib/entitlements/sync-entitlements.js";
import { upsertSubscriptionLedgerState } from "../../../lib/billing/billing-ledger.js";
import { TIER_PRICING } from "../../../lib/catalog/tier-guard.js";
import type { PlatformTier } from "../../../generated/client/client.js";

function tierMonthlyPrice(tier: PlatformTier): string {
  return String(TIER_PRICING[tier]?.priceUsdc ?? 0);
}

function tierAnnualPrice(tier: PlatformTier): string {
  const monthly = TIER_PRICING[tier]?.priceUsdc ?? 0;
  if (monthly <= 0) return "0";
  return String(Math.round(monthly * 12 * 0.8));
}

function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const unsigned = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${sig}`;
}

/**
 * POST /api/v1/platform/billing/embed-token
 *
 * Generates an embed access token for the team's platform subscription billing portal.
 * Auto-creates the required company, default plans, default components, and customer
 * records if they do not exist.
 */
export async function postPlatformBillingEmbed(c: Context) {
  const auth = await requireTeamRoles(c, [
    "OWNER", "ADMIN", "FINANCE", "DEVELOPER", "SUPPORT", "MEMBER",
  ]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any);

  const teamId = auth.team.teamId;

  // Resolve the active environment for this session
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment resolved" }, 409 as any);
  }

  // Look up user details to sync billing name & email
  const user = await db.user.findUnique({
    where: { id: auth.team.userId },
    select: { email: true, walletAddress: true },
  });

  const dbTeam = await db.team.findUnique({
    where: { id: teamId },
    select: { name: true },
  });

  // 1. Resolve or create the platform subscription company
  const company = await ensurePlatformSubscriptionCompany(
    teamId,
    auth.team.walletAddress || user?.walletAddress || undefined,
  );

  // Sync details from session/user to the company record
  const companyName = dbTeam?.name ?? "ArcenPay Platform Workspace";
  const companyEmail = user?.email ?? company.email ?? "";

  await db.arcenCompany.update({
    where: { id: company.id },
    data: {
      name: companyName,
      email: companyEmail || null,
      environmentId: activeEnvironment.id,
    },
  });
  company.name = companyName;
  company.email = companyEmail || null;
  company.environmentId = activeEnvironment.id;

  // 2. Look up team's current tier to ensure a plan exists
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { platformTier: true },
  });
  const currentTier = team?.platformTier ?? "FREE";

  // Build and sync all three platform catalog plans (FREE, PLUS, PRO) in the active environment
  const tiers: PlatformTier[] = ["FREE", "PLUS", "PRO"];
  const planIds: Record<string, string> = {};

  for (const tier of tiers) {
    const planName = `ArcenPay ${tier === "PRO" ? "Enterprise" : tier === "PLUS" ? "Pro" : "Free"} Plan`;

    const entitlements = buildPlatformTierEntitlements(tier);

    const metadata = {
      isPlatformTierPlan: true,
      tier,
      entitlements,
    };

    let plan = await db.catalogPlan.findFirst({
      where: {
        teamId,
        name: planName,
        active: true,
        environmentId: activeEnvironment.id,
      },
    });

    if (!plan) {
      const legacyPlan = await db.catalogPlan.findFirst({
        where: {
          teamId,
          name: planName,
          active: true,
          environmentId: null,
        },
      });

      if (legacyPlan) {
        plan = await db.catalogPlan.update({
          where: { id: legacyPlan.id },
          data: {
            environmentId: activeEnvironment.id,
            metadata: toPrismaJson(metadata),
          },
        });
      } else {
        plan = await db.catalogPlan.create({
          data: {
            teamId,
            environmentId: activeEnvironment.id,
            name: planName,
            tier: tier === "PRO" ? "enterprise" : tier === "PLUS" ? "pro" : "starter",
            description: `ArcenPay platform ${tier} tier subscription`,
            status: "PUBLISHED",
            active: true,
            price: tierMonthlyPrice(tier),
            annualPrice: tierAnnualPrice(tier),
            billingInterval: 2_592_000,
            acceptedToken: "0x0000000000000000000000000000000000000000",
            metadata: toPrismaJson(metadata),
          },
        });
      }
    } else {
      plan = await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          price: tierMonthlyPrice(tier),
          annualPrice: tierAnnualPrice(tier),
          metadata: toPrismaJson(metadata),
        },
      });
    }

    planIds[tier] = plan.id;

    // Sync entitlements to flag rules so features resolve at runtime
    syncEntitlementsToFlagRules(teamId, plan.id, entitlements).catch((err) => {
      console.warn("[platform-billing-embed] Failed to sync tier entitlements:", err);
    });

    // Sync onChainPlanId from bootstrapped platform billing plan to enable SDK checkout
    if (tier !== "FREE") {
      const onChainPlan = await db.platformBillingPlan.findFirst({
        where: {
          chainId: PLATFORM_BILLING_CHAIN_ID,
          tier,
          syncStatus: "SYNCED",
        },
        select: { onChainPlanId: true, acceptedToken: true },
      });

      if (onChainPlan?.onChainPlanId) {
        await db.catalogPlan.update({
          where: { id: plan.id },
          data: {
            onChainPlanId: onChainPlan.onChainPlanId,
            chainId: PLATFORM_BILLING_CHAIN_ID,
            chainSyncStatus: "SYNCED",
            acceptedToken: onChainPlan.acceptedToken ?? "0x0000000000000000000000000000000000000000",
          },
        });
      }
    }
  }

  const catalogPlanId = planIds[currentTier];

  // Auto-assign activePlanId to company if missing
  if (company.activePlanId !== catalogPlanId) {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { activePlanId: catalogPlanId },
    });
    company.activePlanId = catalogPlanId;
  }

  // 3. Ensure subscription state exists
  const existingSub = await db.subscriptionState.findFirst({
    where: { companyId: company.id },
  });

  if (!existingSub && catalogPlanId) {
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    await upsertSubscriptionLedgerState({
      teamId,
      companyId: company.id,
      environmentId: activeEnvironment.id,
      status: "ACTIVE",
      catalogPlanId,
      walletAddress: (auth.team.walletAddress || company.walletAddress || undefined) ?? undefined,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      lastEvent: "platform.tier.initialized",
      lastEventAt: now,
      metadata: {
        source: "platform-billing-embed-init",
        tier: currentTier,
        isPlatformSubscription: true,
      },
    });
  } else if (existingSub) {
    // Sync environmentId and catalogPlanId to subscription state
    await db.subscriptionState.update({
      where: { id: existingSub.id },
      data: {
        environmentId: activeEnvironment.id,
        catalogPlanId: catalogPlanId,
      },
    });
  }

  // 4. Ensure a PlatformBillingCustomer record exists
  let billingCustomer = await db.platformBillingCustomer.findUnique({
    where: { workspaceTeamId: teamId },
  });

  if (!billingCustomer) {
    billingCustomer = await db.platformBillingCustomer.create({
      data: {
        workspaceTeamId: teamId,
        providerTeamId: teamId,
        environmentId: activeEnvironment.id,
        companyId: company.id,
      },
    });
  } else if (billingCustomer.environmentId !== activeEnvironment.id) {
    await db.platformBillingCustomer.update({
      where: { id: billingCustomer.id },
      data: { environmentId: activeEnvironment.id },
    });
  }

  // 5. Find or create default platform billing component with premium design
  let component = await db.embedComponent.findFirst({
    where: { teamId, name: "ArcenPay Platform Billing" },
  });

  if (!component) {
    component = await db.embedComponent.create({
      data: {
        teamId,
        environmentId: activeEnvironment.id,
        name: "ArcenPay Platform Billing",
        elements: toPrismaJson([
          { type: "planManager" },
          { type: "includedFeatures" },
          { type: "plansTable" },
          { type: "invoices" },
        ]),
        design: toPrismaJson({
          primaryColor: "#000000",
          secondaryColor: "#f4f4f5",
          fontFamily: "Geist, Inter, system-ui, sans-serif",
          fontSize: 14,
          fontColor: "#0f172a",
          backgroundColor: "#ffffff",
          borderRadius: 8,
          cardStyle: "minimal",
          columns: 1,
          sections: "separate",
        }),
      },
    });
  } else {
    component = await db.embedComponent.update({
      where: { id: component.id },
      data: {
        design: toPrismaJson({
          primaryColor: "#000000",
          secondaryColor: "#f4f4f5",
          fontFamily: "Geist, Inter, system-ui, sans-serif",
          fontSize: 14,
          fontColor: "#0f172a",
          backgroundColor: "#ffffff",
          borderRadius: 8,
          cardStyle: "minimal",
          columns: 1,
          sections: "separate",
        }),
      },
    });
  }

  // Ensure PlatformBillingAccount mapping exists
  await db.platformBillingAccount.upsert({
    where: { providerTeamId: teamId },
    update: {
      portalComponentId: component.id,
    },
    create: {
      providerTeamId: teamId,
      environmentId: activeEnvironment.id,
      portalComponentId: component.id,
    },
  });

  // 6. Sign and store embed access token
  const secret = process.env.ACCESS_TOKEN_SECRET;
  if (!secret) {
    console.error("[platform-billing-embed] ACCESS_TOKEN_SECRET not set");
    return c.json({ error: "Server configuration error" }, 500 as any);
  }

  const expiresAt = new Date(Date.now() + 3600 * 1000); // 1 hour
  const payload = {
    teamId,
    environmentId: activeEnvironment.id,
    companyId: company.id,
    userId: null,
    componentId: component.id,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
  };

  const token = signToken(payload, secret);
  const tokenHash = createHash("sha256").update(token).digest("hex");

  await db.embedAccessToken.create({
    data: {
      teamId,
      environmentId: activeEnvironment.id,
      tokenHash,
      companyId: company.id,
      userId: null,
      expiresAt,
    },
  });

  return c.json({
    token,
    componentId: component.id,
    expiresAt: expiresAt.toISOString(),
  });
}
