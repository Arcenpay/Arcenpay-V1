import type { ComponentPlanSummary } from "../sdk";

export type BillingPeriod = "monthly" | "annual";

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
    plan.billingInterval >= 31_536_000
    ? "annual"
    : "monthly";
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
