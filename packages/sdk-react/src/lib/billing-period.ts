import type { ComponentPlanSummary } from "../sdk";

export type BillingPeriod = "monthly" | "annual";
const ANNUAL_INTERVAL_SECONDS = 31_536_000;

export function normalizeBillingPeriod(value: unknown): BillingPeriod | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();
  if (normalized === "annual" || normalized === "yearly") return "annual";
  if (normalized === "monthly" || normalized === "month") return "monthly";
  return null;
}

export function deriveBillingPeriodFromPlan(
  plan?: Pick<ComponentPlanSummary, "billingInterval"> | null,
): BillingPeriod {
  return typeof plan?.billingInterval === "number" &&
    plan.billingInterval >= ANNUAL_INTERVAL_SECONDS
    ? "annual"
    : "monthly";
}

export function hasAnnualBillingOption(
  plan?: Pick<ComponentPlanSummary, "billingInterval" | "annualPrice"> | null,
): boolean {
  if (!plan) return false;

  const annualPrice = Number(plan.annualPrice ?? 0);
  if (Number.isFinite(annualPrice) && annualPrice > 0) {
    return true;
  }

  return typeof plan.billingInterval === "number"
    ? plan.billingInterval >= ANNUAL_INTERVAL_SECONDS
    : false;
}

export function matchesPlanBillingPeriod(
  plan: Pick<ComponentPlanSummary, "billingInterval" | "annualPrice"> | null | undefined,
  billingPeriod: BillingPeriod,
): boolean {
  if (!plan) return false;

  if (billingPeriod === "annual") {
    return hasAnnualBillingOption(plan);
  }

  return typeof plan.billingInterval === "number"
    ? plan.billingInterval < ANNUAL_INTERVAL_SECONDS
    : true;
}

export function resolveActiveBillingPeriod(input: {
  billingPeriod?: unknown;
  activePlan?: Pick<ComponentPlanSummary, "billingInterval"> | null;
}): BillingPeriod {
  return (
    normalizeBillingPeriod(input.billingPeriod) ??
    deriveBillingPeriodFromPlan(input.activePlan)
  );
}

export function isCurrentBillingSelection(input: {
  activePlanId?: string | null;
  selectedPlanId?: string | null;
  activeBillingPeriod: BillingPeriod;
  selectedBillingPeriod: BillingPeriod;
}): boolean {
  const selectedPlanId = input.selectedPlanId ?? input.activePlanId ?? null;
  return (
    selectedPlanId === (input.activePlanId ?? null) &&
    input.activeBillingPeriod === input.selectedBillingPeriod
  );
}
