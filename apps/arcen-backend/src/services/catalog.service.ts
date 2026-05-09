import { Prisma } from "../generated/client/client.js";
import {
  normalizeBillingPeriod,
  normalizeCouponCode,
  resolvePlanAmountMicros,
  resolvePublishedInitialPlan,
  resolvePublishedFreePlan,
  resolveCouponQuote,
  incrementCouponRedemption,
  type BillingPeriod,
  type CouponQuote,
  type CouponQuoteResult,
} from '../lib/catalog/catalog-billing';
import {
  listMetadataEntitlements,
  loadPublishedPlanLinksByFeatureKey,
  loadPublishedPlanEntitlementsByFeatureKey,
  type MetadataEntitlementLink,
  type LinkedPlanSummary,
  type LinkedPlanEntitlementSummary,
} from '../lib/catalog/catalog-entitlements';

export class CatalogError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

export class CatalogService {
  // ── Billing Helpers ─────────────────────────────────────────────────────────

  normalizeBillingPeriod(value?: string | null): BillingPeriod {
    return normalizeBillingPeriod(value);
  }

  normalizeCouponCode(value?: string | null): string | null {
    return normalizeCouponCode(value);
  }

  resolvePlanAmountMicros(
    plan: { price: Prisma.Decimal | string | number | null | undefined; annualPrice?: Prisma.Decimal | string | number | null | undefined },
    billingPeriod: BillingPeriod,
  ): number {
    return resolvePlanAmountMicros(plan, billingPeriod);
  }

  // ── Plan Resolution ────────────────────────────────────────────────────────

  async resolvePublishedInitialPlan(teamId: string) {
    try {
      return await resolvePublishedInitialPlan(teamId);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to resolve initial plan",
        500,
        "PLAN_RESOLUTION_FAILED",
      );
    }
  }

  async resolvePublishedFreePlan(teamId: string) {
    try {
      return await resolvePublishedFreePlan(teamId);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to resolve free plan",
        500,
        "PLAN_RESOLUTION_FAILED",
      );
    }
  }

  // ── Coupon Quoting ─────────────────────────────────────────────────────────

  async resolveCouponQuote(input: {
    teamId: string;
    planId: string;
    billingPeriod?: string | null;
    couponCode?: string | null;
  }): Promise<CouponQuoteResult> {
    try {
      return await resolveCouponQuote(input);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to resolve coupon quote",
        500,
        "COUPON_QUOTE_FAILED",
      );
    }
  }

  async incrementCouponRedemption(teamId: string, couponCode: string) {
    try {
      await incrementCouponRedemption(teamId, couponCode);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to increment coupon redemption",
        500,
        "COUPON_REDEMPTION_FAILED",
      );
    }
  }

  // ── Entitlement Mapping ────────────────────────────────────────────────────

  listMetadataEntitlements(metadata: unknown): MetadataEntitlementLink[] {
    return listMetadataEntitlements(metadata);
  }

  async loadPublishedPlanLinksByFeatureKey(teamId: string) {
    try {
      return await loadPublishedPlanLinksByFeatureKey(teamId);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to load plan links",
        500,
        "PLAN_LINKS_LOAD_FAILED",
      );
    }
  }

  async loadPublishedPlanEntitlementsByFeatureKey(teamId: string) {
    try {
      return await loadPublishedPlanEntitlementsByFeatureKey(teamId);
    } catch (error) {
      throw new CatalogError(
        error instanceof Error ? error.message : "Failed to load plan entitlements",
        500,
        "PLAN_ENTITLEMENTS_LOAD_FAILED",
      );
    }
  }
}

export const catalogService = new CatalogService();
