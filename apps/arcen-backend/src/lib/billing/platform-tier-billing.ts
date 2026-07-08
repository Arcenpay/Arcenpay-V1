import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { allocateInvoiceNumber, toSix } from "./invoices.js";
import {
  recordSuccessfulPayment,
  upsertSubscriptionLedgerState,
} from "./billing-ledger.js";
import { deliverWebhook } from "../webhooks/deliver-webhook.js";
import { TIER_PRICING } from "../catalog/tier-guard.js";
import type { PlatformTier } from "../../generated/client/client.js";

const PLATFORM_TIER_COMPANY_KEY = "arcenpay_platform_subscription";
const TIER_PLAN_IDS: Record<string, string> = {};

function buildTierIdempotencyKey(teamId: string, tier: string): string {
  return `platform.tier.activate:${teamId}:${tier}`;
}

function buildTierRenewalIdempotencyKey(
  teamId: string,
  tier: string,
  periodStart: Date,
): string {
  return `platform.tier.renew:${teamId}:${tier}:${periodStart.toISOString().split("T")[0]}`;
}

function tierPricing(tier: PlatformTier): {
  priceUsdPerMonth: number;
  amountMicros: number;
} {
  const plan = TIER_PRICING[tier];
  const price = tier === "FREE" ? 0 : plan.priceUsdc;
  return {
    priceUsdPerMonth: price,
    amountMicros: Math.round(price * 1_000_000),
  };
}

async function ensurePlatformSubscriptionCompany(
  teamId: string,
  walletAddress?: string,
) {
  let company = await db.arcenCompany.findFirst({
    where: {
      teamId,
      traits: {
        path: [PLATFORM_TIER_COMPANY_KEY],
        equals: toPrismaJson(true),
      },
    },
  });

  if (!company) {
    company = await db.arcenCompany.create({
      data: {
        teamId,
        name: "ArcenPay Platform",
        walletAddress: walletAddress ?? null,
        traits: toPrismaJson({ [PLATFORM_TIER_COMPANY_KEY]: true }),
      },
    });
  }

  return company;
}

async function ensureTierCatalogPlan(
  teamId: string,
  tier: PlatformTier,
): Promise<string | null> {
  if (TIER_PLAN_IDS[tier]) return TIER_PLAN_IDS[tier];

  const planName = `ArcenPay ${tier === "PRO" ? "Enterprise" : tier === "PLUS" ? "Pro" : "Free"} Plan`;
  const { amountMicros } = tierPricing(tier);

  let plan = await db.catalogPlan.findFirst({
    where: {
      teamId,
      name: planName,
      active: true,
    },
    select: { id: true },
  });

  if (!plan) {
    plan = await db.catalogPlan.create({
      data: {
        teamId,
        name: planName,
        tier: tier === "PRO" ? "enterprise" : tier === "PLUS" ? "pro" : "starter",
        description: `ArcenPay platform ${tier} tier subscription`,
        status: "PUBLISHED",
        active: true,
        price: tier === "FREE" ? "0" : tier === "PLUS" ? "29" : "99",
        billingInterval: 2_592_000,
        acceptedToken: "0x0000000000000000000000000000000000000000",
        metadata: toPrismaJson({
          isPlatformTierPlan: true,
          tier,
        }),
      },
      select: { id: true },
    });
  }

  TIER_PLAN_IDS[tier] = plan.id;
  return plan.id;
}

export async function activateTeamPlatformTier(input: {
  teamId: string;
  targetTier: PlatformTier;
  walletAddress?: string;
  txHash?: string;
}): Promise<{
  ok: boolean;
  subscriptionStateId: string | null;
  invoiceId: string | null;
  paymentId: string | null;
  error?: string;
}> {
  const { teamId, targetTier, walletAddress, txHash } = input;
  if (targetTier === "FREE") {
    return { ok: true, subscriptionStateId: null, invoiceId: null, paymentId: null };
  }

  const { amountMicros } = tierPricing(targetTier);
  const idempotencyKey = buildTierIdempotencyKey(teamId, targetTier);

  const existing = await db.subscriptionState.findFirst({
    where: {
      teamId,
      company: { traits: { path: [PLATFORM_TIER_COMPANY_KEY], equals: toPrismaJson(true) } },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: true,
      subscriptionStateId: existing.id,
      invoiceId: null,
      paymentId: null,
    };
  }

  const company = await ensurePlatformSubscriptionCompany(teamId, walletAddress);
  const catalogPlanId = await ensureTierCatalogPlan(teamId, targetTier);

  if (!catalogPlanId) {
    return {
      ok: false,
      subscriptionStateId: null,
      invoiceId: null,
      paymentId: null,
      error: "Failed to ensure tier catalog plan",
    };
  }

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const invoiceNumber = await allocateInvoiceNumber(teamId, "AP", now);

  const invoice = await db.invoice.create({
    data: {
      teamId,
      number: invoiceNumber,
      status: "PAID",
      currency: "USDC",
      subtotal: toSix(amountMicros),
      total: toSix(amountMicros),
      amountPaid: toSix(amountMicros),
      amountOutstanding: "0.000000",
      planId: catalogPlanId,
      companyId: company.id,
      issuedAt: now,
      paidAt: now,
      metadata: toPrismaJson({
        source: "platform-tier-activation",
        tier: targetTier,
      }),
      lineItems: {
        create: {
          description: `ArcenPay ${targetTier} Tier — Monthly Subscription`,
          quantity: 1,
          unitAmount: toSix(amountMicros),
          lineSubtotal: toSix(amountMicros),
          lineTotal: toSix(amountMicros),
          metadata: toPrismaJson({ tier: targetTier }),
        },
      },
    },
    select: { id: true },
  });

  const payment = await recordSuccessfulPayment({
    idempotencyKey,
    teamId,
    companyId: company.id,
    invoiceId: invoice.id,
    kind: "SUBSCRIPTION_ACTIVATION",
    amount: amountMicros,
    currency: "USDC",
    txHash: txHash ?? null,
    occurredAt: now,
    settledAt: now,
    metadata: { source: "platform-tier-activation", tier: targetTier },
  });

  const subscriptionState = await upsertSubscriptionLedgerState({
    teamId,
    companyId: company.id,
    status: "ACTIVE",
    catalogPlanId,
    walletAddress: walletAddress ?? company.walletAddress,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    lastEvent: "platform.tier.activated",
    lastEventAt: now,
    lastSourceTxHash: txHash ?? null,
    metadata: {
      source: "platform-tier-activation",
      tier: targetTier,
      isPlatformSubscription: true,
    },
  });

  if (subscriptionState) {
    await db.team.update({
      where: { id: teamId },
      data: {
        tierSubscriptionId: subscriptionState.id,
        tierExpiresAt: periodEnd,
      },
    });
  }

  deliverWebhook(teamId, "platform.tier.activated", {
    teamId,
    tier: targetTier,
    subscriptionStateId: subscriptionState?.id ?? null,
    invoiceId: invoice.id,
    paymentId: payment.id,
    effectiveAt: now.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver activation webhook:", err);
  });

  return {
    ok: true,
    subscriptionStateId: subscriptionState?.id ?? null,
    invoiceId: invoice.id,
    paymentId: payment.id,
  };
}

export async function renewTeamPlatformTier(input: {
  teamId: string;
  now?: Date;
}): Promise<{
  ok: boolean;
  renewed: boolean;
  subscriptionStateId: string | null;
  error?: string;
}> {
  const { teamId } = input;
  const now = input.now ?? new Date();

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      platformTier: true,
      tierExpiresAt: true,
      tierSubscriptionId: true,
    },
  });

  if (!team || team.platformTier === "FREE" || !team.tierSubscriptionId) {
    return { ok: true, renewed: false, subscriptionStateId: null };
  }

  const subscriptionState = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: { id: true, status: true, currentPeriodEnd: true, catalogPlanId: true },
  });

  if (!subscriptionState || subscriptionState.status === "CANCELLED") {
    return { ok: true, renewed: false, subscriptionStateId: null };
  }

  if (subscriptionState.currentPeriodEnd && subscriptionState.currentPeriodEnd > now) {
    return {
      ok: true,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
    };
  }

  const { amountMicros } = tierPricing(team.platformTier);
  const idempotencyKey = buildTierRenewalIdempotencyKey(
    teamId,
    team.platformTier,
    subscriptionState.currentPeriodEnd ?? now,
  );

  const existingPayment = await db.payment.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });

  if (existingPayment) {
    return {
      ok: true,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
    };
  }

  const company = await ensurePlatformSubscriptionCompany(teamId);
  const planId = subscriptionState.catalogPlanId ?? (await ensureTierCatalogPlan(teamId, team.platformTier));

  if (!planId) {
    return {
      ok: false,
      renewed: false,
      subscriptionStateId: subscriptionState.id,
      error: "Missing tier catalog plan",
    };
  }

  const periodStart = subscriptionState.currentPeriodEnd ?? now;
  const periodEnd = new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000);
  const invoiceNumber = await allocateInvoiceNumber(teamId, "AP", now);

  const invoice = await db.invoice.create({
    data: {
      teamId,
      number: invoiceNumber,
      status: "PAID",
      currency: "USDC",
      subtotal: toSix(amountMicros),
      total: toSix(amountMicros),
      amountPaid: toSix(amountMicros),
      amountOutstanding: "0.000000",
      planId,
      companyId: company.id,
      issuedAt: now,
      paidAt: now,
      metadata: toPrismaJson({
        source: "platform-tier-renewal",
        tier: team.platformTier,
      }),
      lineItems: {
        create: {
          description: `ArcenPay ${team.platformTier} Tier — Monthly Renewal`,
          quantity: 1,
          unitAmount: toSix(amountMicros),
          lineSubtotal: toSix(amountMicros),
          lineTotal: toSix(amountMicros),
          metadata: toPrismaJson({ tier: team.platformTier }),
        },
      },
    },
    select: { id: true },
  });

  await recordSuccessfulPayment({
    idempotencyKey,
    teamId,
    companyId: company.id,
    invoiceId: invoice.id,
    kind: "SUBSCRIPTION_RENEWAL",
    amount: amountMicros,
    currency: "USDC",
    occurredAt: now,
    settledAt: now,
    metadata: { source: "platform-tier-renewal", tier: team.platformTier },
  });

  await upsertSubscriptionLedgerState({
    teamId,
    companyId: company.id,
    status: "ACTIVE",
    catalogPlanId: planId,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    lastEvent: "platform.tier.renewed",
    lastEventAt: now,
    metadata: {
      source: "platform-tier-renewal",
      tier: team.platformTier,
      isPlatformSubscription: true,
    },
  });

  await db.team.update({
    where: { id: teamId },
    data: { tierExpiresAt: periodEnd },
  });

  deliverWebhook(teamId, "platform.tier.renewed", {
    teamId,
    tier: team.platformTier,
    subscriptionStateId: subscriptionState.id,
    invoiceId: invoice.id,
    effectiveAt: now.toISOString(),
    nextPeriodEnd: periodEnd.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver renewal webhook:", err);
  });

  return {
    ok: true,
    renewed: true,
    subscriptionStateId: subscriptionState.id,
  };
}

export async function cancelTeamPlatformTier(input: {
  teamId: string;
  now?: Date;
}): Promise<{ ok: boolean; error?: string }> {
  const { teamId } = input;
  const now = input.now ?? new Date();

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { tierSubscriptionId: true },
  });

  if (!team?.tierSubscriptionId) {
    return { ok: true };
  }

  const subscriptionState = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: { id: true, status: true },
  });

  if (!subscriptionState || subscriptionState.status === "CANCELLED") {
    return { ok: true };
  }

  await db.subscriptionState.update({
    where: { id: team.tierSubscriptionId },
    data: {
      status: "CANCELLED",
      cancelledAt: now,
      cancelAtPeriodEnd: false,
      lastEvent: "platform.tier.cancelled",
      lastEventAt: now,
    },
  });

  await db.team.update({
    where: { id: teamId },
    data: {
      platformTier: "FREE",
      tierExpiresAt: null,
      tierSubscriptionId: null,
    },
  });

  deliverWebhook(teamId, "platform.tier.cancelled", {
    teamId,
    effectiveAt: now.toISOString(),
  }).catch((err) => {
    console.warn("[platform-tier-billing] Failed to deliver cancellation webhook:", err);
  });

  return { ok: true };
}

export async function getTeamPlatformSubscription(teamId: string): Promise<{
  status: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueAt: Date | null;
  graceEndsAt: Date | null;
  tier: string | null;
  amountMicros: number;
} | null> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: {
      platformTier: true,
      tierExpiresAt: true,
      tierSubscriptionId: true,
    },
  });

  if (!team || !team.tierSubscriptionId) return null;

  const state = await db.subscriptionState.findUnique({
    where: { id: team.tierSubscriptionId },
    select: {
      status: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      pastDueAt: true,
      graceEndsAt: true,
    },
  });

  if (!state) return null;

  const { amountMicros } = tierPricing(team.platformTier);

  return {
    status: state.status,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    pastDueAt: state.pastDueAt,
    graceEndsAt: state.graceEndsAt,
    tier: team.platformTier,
    amountMicros,
  };
}

export async function runPlatformTierDunningSweep(options?: {
  now?: Date;
  teamId?: string;
  limit?: number;
}): Promise<{
  scanned: number;
  enforced: number;
  skipped: number;
  results: Array<{
    teamId: string;
    fromTier: string;
    subscriptionStateId: string | null;
  }>;
}> {
  const now = options?.now ?? new Date();

  const candidates = await db.subscriptionState.findMany({
    where: {
      ...(options?.teamId ? { teamId: options.teamId } : {}),
      status: "PAST_DUE",
      graceEndsAt: { lte: now },
      metadata: {
        path: ["isPlatformSubscription"],
        equals: toPrismaJson(true),
      },
    },
    orderBy: { graceEndsAt: "asc" },
    take: options?.limit ?? 50,
    select: {
      id: true,
      teamId: true,
    },
  });

  const results: Array<{
    teamId: string;
    fromTier: string;
    subscriptionStateId: string | null;
  }> = [];

  for (const state of candidates) {
    const team = await db.team.findUnique({
      where: { id: state.teamId },
      select: { platformTier: true },
    });

    if (!team || team.platformTier === "FREE") {
      results.push({
        teamId: state.teamId,
        fromTier: team?.platformTier ?? "UNKNOWN",
        subscriptionStateId: state.id,
      });
      continue;
    }

    await db.$transaction([
      db.team.update({
        where: { id: state.teamId },
        data: {
          platformTier: "FREE",
          tierExpiresAt: null,
          tierSubscriptionId: null,
        },
      }),
      db.subscriptionState.update({
        where: { id: state.id },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
          lastEvent: "platform.tier.dunning_enforced",
          lastEventAt: now,
        },
      }),
    ]);

    deliverWebhook(state.teamId, "platform.tier.downgraded", {
      teamId: state.teamId,
      fromTier: team.platformTier,
      toTier: "FREE",
      reason: "dunning_enforced",
      enforcedAt: now.toISOString(),
    }).catch((err) => {
      console.warn("[platform-tier-billing] Failed to deliver dunning webhook:", err);
    });

    results.push({
      teamId: state.teamId,
      fromTier: team.platformTier,
      subscriptionStateId: state.id,
    });
  }

  return {
    scanned: candidates.length,
    enforced: results.length,
    skipped: results.filter((r) => r.subscriptionStateId === null).length,
    results,
  };
}

export async function runPlatformTierRenewalSweep(input?: {
  now?: Date;
  teamId?: string;
  limit?: number;
}): Promise<{
  scanned: number;
  renewed: number;
  failed: number;
  results: Array<{
    teamId: string;
    tier: string;
    renewed: boolean;
    error?: string;
  }>;
}> {
  const now = input?.now ?? new Date();
  const buffer = 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() + buffer);

  const candidates = await db.team.findMany({
    where: {
      ...(input?.teamId ? { id: input.teamId } : {}),
      platformTier: { not: "FREE" },
      tierExpiresAt: { lte: cutoff, not: null },
    },
    orderBy: { tierExpiresAt: "asc" },
    take: input?.limit ?? 50,
    select: {
      id: true,
      platformTier: true,
    },
  });

  const results: Array<{
    teamId: string;
    tier: string;
    renewed: boolean;
    error?: string;
  }> = [];

  for (const team of candidates) {
    try {
      const result = await renewTeamPlatformTier({ teamId: team.id, now });
      results.push({
        teamId: team.id,
        tier: team.platformTier,
        renewed: result.renewed,
        error: result.error,
      });
    } catch (err) {
      results.push({
        teamId: team.id,
        tier: team.platformTier,
        renewed: false,
        error: String(err),
      });
    }
  }

  return {
    scanned: candidates.length,
    renewed: results.filter((r) => r.renewed).length,
    failed: results.filter((r) => !r.renewed && r.error).length,
    results,
  };
}
