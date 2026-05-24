import { describe, expect, it } from "vitest";
import {
  deriveBillingPeriodFromPlan,
  hasAnnualBillingOption,
  isCurrentBillingSelection,
  matchesPlanBillingPeriod,
  normalizeBillingPeriod,
  resolveActiveBillingPeriod,
} from "../src/lib/billing-period";

describe("billing period helpers", () => {
  it("normalizes supported billing period values", () => {
    expect(normalizeBillingPeriod("monthly")).toBe("monthly");
    expect(normalizeBillingPeriod("yearly")).toBe("annual");
    expect(normalizeBillingPeriod("weekly")).toBeNull();
  });

  it("falls back to the active plan interval when no explicit billing period exists", () => {
    expect(
      resolveActiveBillingPeriod({
        activePlan: { billingInterval: 31_536_000 },
      }),
    ).toBe("annual");
    expect(
      deriveBillingPeriodFromPlan({
        billingInterval: 2_592_000,
      }),
    ).toBe("monthly");
  });

  it("treats same-plan cadence changes as a different selection", () => {
    expect(
      isCurrentBillingSelection({
        activePlanId: "plan_pro",
        selectedPlanId: "plan_pro",
        activeBillingPeriod: "monthly",
        selectedBillingPeriod: "annual",
      }),
    ).toBe(false);
  });

  it("treats string annualPrice as a valid annual option", () => {
    const monthlyPlanWithAnnualPrice = {
      billingInterval: 2_592_000,
      annualPrice: "99.000000",
    } as const;

    expect(hasAnnualBillingOption(monthlyPlanWithAnnualPrice)).toBe(true);
    expect(
      matchesPlanBillingPeriod(monthlyPlanWithAnnualPrice, "annual"),
    ).toBe(true);
    expect(
      matchesPlanBillingPeriod(monthlyPlanWithAnnualPrice, "monthly"),
    ).toBe(true);
  });

  it("does not treat monthly plans without annual pricing as annual-capable", () => {
    const monthlyOnlyPlan = {
      billingInterval: 2_592_000,
      annualPrice: null,
    } as const;

    expect(hasAnnualBillingOption(monthlyOnlyPlan)).toBe(false);
    expect(matchesPlanBillingPeriod(monthlyOnlyPlan, "annual")).toBe(false);
    expect(matchesPlanBillingPeriod(monthlyOnlyPlan, "monthly")).toBe(true);
  });
});
