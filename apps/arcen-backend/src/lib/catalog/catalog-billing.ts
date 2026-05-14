import { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";

export type BillingPeriod = "monthly" | "annual";

type PriceLike =
  | Prisma.Decimal
  | string
  | number
  | null
  | undefined;

type CouponRow = {
  code: string;
  description: string | null;
  discountPercent: number;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  applicablePlanId: string | null;
  billingPeriod: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
};

type CouponQuoteInput = {
  teamId: string;
  planId: string;
  billingPeriod?: string | null;
  couponCode?: string | null;
};

export type CouponQuote = {
  planId: string;
  billingPeriod: BillingPeriod;
  baseAmount: string;
  baseAmountMicros: number;
  finalAmount: string;
  finalAmountMicros: number;
  currency: "USDC";
  coupon:
    | {
        code: string;
        description: string | null;
        discountPercent: number;
      }
    | null;
};

export type CouponQuoteResult =
  | { ok: true; quote: CouponQuote }
  | { ok: false; status: 400 | 404 | 409; error: string };

function priceToMicros(value: PriceLike): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric * 1_000_000);
}

function microsToAmountString(value: number): string {
  return (value / 1_000_000).toFixed(6);
}

export function normalizeBillingPeriod(
  value?: string | null,
): BillingPeriod {
  if (value === "annual" || value === "yearly") {
    return "annual";
  }
  return "monthly";
}

export function normalizeCouponCode(value?: string | null): string | null {
  const trimmed = value?.trim().toUpperCase();
  return trimmed ? trimmed : null;
}

export function resolvePlanAmountMicros(
  plan: { price: PriceLike; annualPrice?: PriceLike },
  billingPeriod: BillingPeriod,
): number {
  const annualMicros = priceToMicros(plan.annualPrice);
  if (billingPeriod === "annual" && annualMicros > 0) {
    return annualMicros;
  }
  return priceToMicros(plan.price);
}

type PublishedPlanIdentity = {
  id: string;
  name: string;
  tier?: string | null;
};

async function resolveConfiguredPublishedPlan(
  teamId: string,
  environmentMode: "DEVELOPMENT" | "PRODUCTION",
  environmentId: string | null,
  preference: string | null | undefined,
  requireFree: boolean,
): Promise<PublishedPlanIdentity | null> {
  const candidate = preference?.trim();
  if (!candidate) return null;

  return db.catalogPlan.findFirst({
    where: {
      teamId,
      environmentMode,
      ...(environmentId ? { environmentId } : {}),
      status: "PUBLISHED",
      active: true,
      ...(requireFree
        ? { price: { equals: new Prisma.Decimal(0) } }
        : {}),
      OR: [{ id: candidate }, { name: candidate }, { tier: candidate }],
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true, tier: true },
  });
}

async function resolveEnvironmentSelection(
  teamId: string,
  environmentId?: string | null,
): Promise<{
  environmentId: string | null;
  environmentMode: "DEVELOPMENT" | "PRODUCTION";
}> {
  if (environmentId) {
    const environment = await db.workspaceEnvironment.findFirst({
      where: { id: environmentId, teamId },
      select: { id: true, mode: true },
    });
    if (environment) {
      return {
        environmentId: environment.id,
        environmentMode: environment.mode,
      };
    }
  }

  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { environmentMode: true },
  });

  return {
    environmentId: null,
    environmentMode: team?.environmentMode ?? "DEVELOPMENT",
  };
}

export async function resolvePublishedInitialPlan(
  teamId: string,
  environmentId?: string | null,
): Promise<{
  id: string;
  name: string;
} | null> {
  const selection = await resolveEnvironmentSelection(teamId, environmentId);
  const config = selection.environmentId
    ? await db.catalogConfig.findUnique({
        where: { environmentId: selection.environmentId },
        select: { initialPlan: true },
      })
    : await db.catalogConfig.findFirst({
        where: {
          teamId,
          environmentMode: selection.environmentMode,
        },
        orderBy: { createdAt: "asc" },
        select: { initialPlan: true },
      });

  const configuredPlan = await resolveConfiguredPublishedPlan(
    teamId,
    selection.environmentMode,
    selection.environmentId,
    config?.initialPlan,
    false,
  );
  if (configuredPlan) {
    return { id: configuredPlan.id, name: configuredPlan.name };
  }

  return resolvePublishedFreePlan(teamId, selection.environmentId);
}

export async function resolvePublishedFreePlan(
  teamId: string,
  environmentId?: string | null,
): Promise<{
  id: string;
  name: string;
} | null> {
  const selection = await resolveEnvironmentSelection(teamId, environmentId);
  const config = selection.environmentId
    ? await db.catalogConfig.findUnique({
        where: { environmentId: selection.environmentId },
        select: { fallbackPlan: true, initialPlan: true },
      })
    : await db.catalogConfig.findFirst({
        where: {
          teamId,
          environmentMode: selection.environmentMode,
        },
        orderBy: { createdAt: "asc" },
        select: { fallbackPlan: true, initialPlan: true },
      });

  for (const preference of [config?.fallbackPlan, config?.initialPlan]) {
    const configuredFreePlan = await resolveConfiguredPublishedPlan(
      teamId,
      selection.environmentMode,
      selection.environmentId,
      preference,
      true,
    );
    if (configuredFreePlan) {
      return { id: configuredFreePlan.id, name: configuredFreePlan.name };
    }
  }

  return db.catalogPlan.findFirst({
    where: {
      teamId,
      environmentMode: selection.environmentMode,
      status: "PUBLISHED",
      active: true,
      price: { equals: new Prisma.Decimal(0) },
      ...(selection.environmentId
        ? { environmentId: selection.environmentId }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }],
    select: { id: true, name: true },
  });
}

export async function resolveCouponQuote(
  input: CouponQuoteInput,
): Promise<CouponQuoteResult> {
  const billingPeriod = normalizeBillingPeriod(input.billingPeriod);
  const plan = await db.catalogPlan.findFirst({
    where: {
      id: input.planId,
      teamId: input.teamId,
      status: "PUBLISHED",
      active: true,
    },
    select: {
      id: true,
      price: true,
      annualPrice: true,
    },
  });

  if (!plan) {
    return {
      ok: false,
      status: 404,
      error: "Plan not found or not published",
    };
  }

  const baseAmountMicros = resolvePlanAmountMicros(plan, billingPeriod);
  const baseQuote: CouponQuote = {
    planId: plan.id,
    billingPeriod,
    baseAmount: microsToAmountString(baseAmountMicros),
    baseAmountMicros,
    finalAmount: microsToAmountString(baseAmountMicros),
    finalAmountMicros: baseAmountMicros,
    currency: "USDC",
    coupon: null,
  };

  const couponCode = normalizeCouponCode(input.couponCode);
  if (!couponCode) {
    return { ok: true, quote: baseQuote };
  }

  const [coupon] = await db.$queryRaw<CouponRow[]>(Prisma.sql`
    SELECT
      "code",
      "description",
      "discountPercent",
      "active",
      "startsAt",
      "expiresAt",
      "applicablePlanId",
      "billingPeriod",
      "maxRedemptions",
      "redemptionCount"
    FROM "CatalogCoupon"
    WHERE "teamId" = ${input.teamId}
      AND "code" = ${couponCode}
    LIMIT 1
  `);

  if (!coupon || !coupon.active) {
    return { ok: false, status: 404, error: "Invalid or expired coupon" };
  }

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) {
    return { ok: false, status: 404, error: "Coupon is not active yet" };
  }
  if (coupon.expiresAt && coupon.expiresAt <= now) {
    return { ok: false, status: 404, error: "Invalid or expired coupon" };
  }
  if (
    typeof coupon.maxRedemptions === "number" &&
    coupon.redemptionCount >= coupon.maxRedemptions
  ) {
    return { ok: false, status: 409, error: "Coupon redemption limit reached" };
  }
  if (coupon.applicablePlanId && coupon.applicablePlanId !== plan.id) {
    return { ok: false, status: 409, error: "Coupon is not valid for this plan" };
  }
  if (
    coupon.billingPeriod &&
    normalizeBillingPeriod(coupon.billingPeriod) !== billingPeriod
  ) {
    return {
      ok: false,
      status: 409,
      error: "Coupon is not valid for this billing period",
    };
  }

  const boundedDiscount = Math.min(
    100,
    Math.max(0, Math.trunc(coupon.discountPercent)),
  );
  const finalAmountMicros = Math.max(
    0,
    Math.round((baseAmountMicros * (100 - boundedDiscount)) / 100),
  );

  return {
    ok: true,
    quote: {
      ...baseQuote,
      finalAmount: microsToAmountString(finalAmountMicros),
      finalAmountMicros,
      coupon: {
        code: coupon.code,
        description: coupon.description,
        discountPercent: boundedDiscount,
      },
    },
  };
}

export async function incrementCouponRedemption(
  teamId: string,
  couponCode: string,
): Promise<void> {
  const normalizedCode = normalizeCouponCode(couponCode);
  if (!normalizedCode) return;

  await db.$executeRaw(Prisma.sql`
    UPDATE "CatalogCoupon"
    SET
      "redemptionCount" = "redemptionCount" + 1,
      "updatedAt" = NOW()
    WHERE "teamId" = ${teamId}
      AND "code" = ${normalizedCode}
  `);
}
