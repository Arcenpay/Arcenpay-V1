import { randomBytes } from "node:crypto";
import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { PLATFORM_BILLING_CHAIN_ID } from "../../config.js";
import { TIER_PRICING } from "../catalog/tier-guard.js";
import { syncEntitlementsToFlagRules } from "../entitlements/sync-entitlements.js";
import {
  buildPlatformTierEntitlements,
} from "./platform-tier-billing.js";
import {
  ensurePlatformBillingCustomer,
  projectPlatformBillingEntitlement,
} from "./platform-billing-customer.js";
import { upsertSubscriptionLedgerState } from "./billing-ledger.js";

const PLATFORM_COMPONENT_NAME = "ArcenPay Platform Billing";

function platformPlanName(tier: "FREE" | "PLUS" | "PRO"): string {
  return `ArcenPay ${tier === "PRO" ? "Enterprise" : tier === "PLUS" ? "Pro" : "Free"} Plan`;
}

function platformPlanTier(tier: "FREE" | "PLUS" | "PRO"): string {
  return tier === "PRO" ? "enterprise" : tier === "PLUS" ? "pro" : "starter";
}

function platformAnnualPrice(tier: "FREE" | "PLUS" | "PRO"): string {
  const monthly = TIER_PRICING[tier].priceUsdc;
  return monthly === 0 ? "0" : String(Math.round(monthly * 12 * 0.8));
}

async function providerAccount(environmentId?: string | null) {
  return db.platformBillingAccount.findFirst({
    where: environmentId ? { environmentId } : undefined,
    select: {
      providerTeamId: true,
      environmentId: true,
      environment: { select: { mode: true } },
      portalComponentId: true,
    },
  });
}

async function ensurePlatformPlan(
  providerTeamId: string,
  environmentId: string,
  tier: "FREE" | "PLUS" | "PRO",
) {
  const name = platformPlanName(tier);
  const entitlements = buildPlatformTierEntitlements(tier);
  const metadata = toPrismaJson({
    isPlatformTierPlan: true,
    isFirstPartyPlan: true,
    tier,
    entitlements,
  });

  let plan = await db.catalogPlan.findFirst({
    where: { teamId: providerTeamId, environmentId, name },
  });

  if (!plan) {
    try {
      plan = await db.catalogPlan.create({
        data: {
          teamId: providerTeamId,
          environmentId,
          name,
          tier: platformPlanTier(tier),
          description: `ArcenPay platform ${tier} tier subscription`,
          status: "PUBLISHED",
          active: true,
          price: String(TIER_PRICING[tier].priceUsdc),
          annualPrice: platformAnnualPrice(tier),
          billingInterval: 2_592_000,
          acceptedToken: "0x0000000000000000000000000000000000000000",
          metadata,
        },
      });
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      plan = await db.catalogPlan.findFirstOrThrow({
        where: { teamId: providerTeamId, environmentId, name },
      });
    }
  } else {
    plan = await db.catalogPlan.update({
      where: { id: plan.id },
      data: {
        status: "PUBLISHED",
        active: true,
        price: String(TIER_PRICING[tier].priceUsdc),
        annualPrice: platformAnnualPrice(tier),
        metadata,
      },
    });
  }

  syncEntitlementsToFlagRules(providerTeamId, plan.id, entitlements).catch((error) => {
    console.warn("[platform-enrollment] Entitlement sync failed:", error);
  });

  if (tier !== "FREE") {
    const platformPlan = await db.platformBillingPlan.findUnique({
      where: {
        environmentId_chainId_tier: {
          environmentId,
          chainId: PLATFORM_BILLING_CHAIN_ID,
          tier,
        },
      },
      select: { onChainPlanId: true, acceptedToken: true, chainId: true },
    });
    if (platformPlan?.onChainPlanId) {
      plan = await db.catalogPlan.update({
        where: { id: plan.id },
        data: {
          chainId: platformPlan.chainId,
          onChainPlanId: platformPlan.onChainPlanId,
          chainSyncStatus: "SYNCED",
          acceptedToken: platformPlan.acceptedToken,
        },
      });
    }
  }

  return plan;
}

async function ensurePortalComponent(
  providerTeamId: string,
  environmentId: string,
  existingId: string | null,
) {
  if (existingId) {
    return db.embedComponent.findUniqueOrThrow({ where: { id: existingId } });
  }

  const existing = await db.embedComponent.findFirst({
    where: { teamId: providerTeamId, name: PLATFORM_COMPONENT_NAME },
  });
  if (existing) return existing;

  return db.embedComponent.create({
    data: {
      teamId: providerTeamId,
      environmentId,
      name: PLATFORM_COMPONENT_NAME,
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
}

export async function getPlatformBillingStatus(workspaceTeamId: string) {
  // The current team model does not persist an active environment pointer;
  // use the configured provider account and let enrollment select explicitly.
  const account = await providerAccount();
  if (!account) {
    return { configured: false as const, enrolled: false as const };
  }

  const customer = await db.platformBillingCustomer.findUnique({
    where: { workspaceTeamId },
    select: { companyId: true, providerTeamId: true, environmentId: true },
  });
  const validCustomer = customer && customer.providerTeamId === account.providerTeamId;
  const subscription = validCustomer
    ? await db.subscriptionState.findUnique({
        where: { companyId: customer.companyId },
        select: {
          id: true,
          status: true,
          catalogPlanId: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          pastDueAt: true,
          graceEndsAt: true,
        },
      })
    : null;

  const plans = await db.catalogPlan.findMany({
    where: {
      teamId: account.providerTeamId,
      environmentId: account.environmentId,
      metadata: { path: ["isFirstPartyPlan"], equals: toPrismaJson(true) },
      active: true,
    },
    select: { id: true, name: true, tier: true, price: true, annualPrice: true, chainId: true, onChainPlanId: true },
    orderBy: { price: "asc" },
  });

  const availablePlans = plans.filter(
    (plan) => plan.tier === "starter" || Boolean(plan.chainId && plan.onChainPlanId),
  );

  return {
    configured: true as const,
    enrolled: Boolean(validCustomer && subscription),
    providerTeamId: account.providerTeamId,
    environmentId: account.environmentId,
    portalComponentId: account.portalComponentId,
    customer,
    subscription,
    plans: availablePlans,
  };
}

export async function enrollWorkspaceInPlatformBilling(input: {
  workspaceTeamId: string;
  workspaceEnvironmentId?: string | null;
  email?: string | null;
  name?: string | null;
}): Promise<{
  providerTeamId: string;
  providerEnvironmentId: string;
  companyId: string;
  componentId: string;
  subscriptionStateId: string;
  planIds: Record<"FREE" | "PLUS" | "PRO", string>;
}> {
  const account = await providerAccount(input.workspaceEnvironmentId);
  if (!account) {
    throw new Error("Platform billing provider is not configured.");
  }

  const providerTeam = await db.team.findUnique({
    where: { id: account.providerTeamId },
    select: { id: true },
  });
  if (!providerTeam) throw new Error("Platform billing provider team was not found.");

  const [workspace, customer] = await Promise.all([
    db.team.findUnique({ where: { id: input.workspaceTeamId }, select: { id: true, name: true } }),
    ensurePlatformBillingCustomer({
      workspaceTeamId: input.workspaceTeamId,
      environmentId: input.workspaceEnvironmentId,
    }),
  ]);
  if (!workspace) throw new Error("Workspace was not found.");
  if (!customer.configured) throw new Error("Platform billing provider is not configured.");

  const company = await db.arcenCompany.update({
    where: { id: customer.companyId },
    data: {
      name: input.name?.trim() || workspace.name,
      email: input.email?.trim().toLowerCase() || undefined,
      environmentId: account.environmentId,
    },
  });

  const [freePlan, plusPlan, proPlan] = await Promise.all([
    ensurePlatformPlan(account.providerTeamId, account.environmentId, "FREE"),
    ensurePlatformPlan(account.providerTeamId, account.environmentId, "PLUS"),
    ensurePlatformPlan(account.providerTeamId, account.environmentId, "PRO"),
  ]);
  const platformPlanIds = [freePlan.id, plusPlan.id, proPlan.id];
  await db.catalogConfig.upsert({
    where: { environmentId: account.environmentId },
    update: {
      livePlanIds: platformPlanIds,
      restrictLivePlans: true,
      initialPlan: freePlan.id,
      fallbackPlan: freePlan.id,
    },
    create: {
      teamId: account.providerTeamId,
      environmentId: account.environmentId,
      environmentMode: account.environment.mode,
      livePlanIds: platformPlanIds,
      restrictLivePlans: true,
      initialPlan: freePlan.id,
      fallbackPlan: freePlan.id,
    },
  });

  const existing = await db.subscriptionState.findUnique({
    where: { companyId: company.id },
    select: { id: true },
  });
  const state = existing
    ? await db.subscriptionState.update({
        where: { id: existing.id },
        data: { environmentId: account.environmentId, catalogPlanId: freePlan.id },
      })
    : await upsertSubscriptionLedgerState({
        teamId: account.providerTeamId,
        companyId: company.id,
        environmentId: account.environmentId,
        status: "ACTIVE",
        catalogPlanId: freePlan.id,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        lastEvent: "platform.billing.enrolled",
        lastEventAt: new Date(),
        metadata: {
          source: "platform-billing-enrollment",
          tier: "FREE",
          isPlatformSubscription: true,
        },
      });
  if (!state) throw new Error("Failed to create platform billing subscription state.");

  await projectPlatformBillingEntitlement({
    providerTeamId: account.providerTeamId,
    companyId: company.id,
  });

  const component = await ensurePortalComponent(
    account.providerTeamId,
    account.environmentId,
    account.portalComponentId,
  );
  await db.platformBillingAccount.update({
    where: { providerTeamId_environmentId: { providerTeamId: account.providerTeamId, environmentId: account.environmentId } },
    data: { portalComponentId: component.id },
  });

  return {
    providerTeamId: account.providerTeamId,
    providerEnvironmentId: account.environmentId,
    companyId: company.id,
    componentId: component.id,
    subscriptionStateId: state.id,
    planIds: { FREE: freePlan.id, PLUS: plusPlan.id, PRO: proPlan.id },
  };
}

export async function issuePlatformBillingEmbedToken(input: {
  workspaceTeamId: string;
  providerTeamId: string;
  companyId: string;
  componentId: string;
  environmentId: string;
}): Promise<{ token: string; expiresAt: Date }> {
  const secret = process.env.ACCESS_TOKEN_SECRET?.trim();
  if (!secret) throw new Error("ACCESS_TOKEN_SECRET is not configured.");

  const expiresAt = new Date(Date.now() + 3600 * 1000);
  const payload = {
    teamId: input.providerTeamId,
    environmentId: input.environmentId,
    companyId: input.companyId,
    componentId: input.componentId,
    workspaceTeamId: input.workspaceTeamId,
    exp: Math.floor(expiresAt.getTime() / 1000),
    iat: Math.floor(Date.now() / 1000),
    jti: randomBytes(16).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const unsigned = `${header}.${body}`;
  const { createHmac, createHash } = await import("node:crypto");
  const token = `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
  await db.embedAccessToken.create({
    data: {
      teamId: input.providerTeamId,
      environmentId: input.environmentId,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      companyId: input.companyId,
      expiresAt,
    },
  });
  return { token, expiresAt };
}
