import { describe, expect, it } from "vitest";
import {
  deriveBillingPeriodFromPlan,
  isCurrentBillingSelection,
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
});
