import { describe, expect, it } from "vitest";

import {
  normalizeBillingPeriod,
  resolvePlanAmountMicros,
} from "..\/catalog-billing";

describe("catalog billing helpers", () => {
  it("treats yearly aliases as annual billing", () => {
    expect(normalizeBillingPeriod("monthly")).toBe("monthly");
    expect(normalizeBillingPeriod("annual")).toBe("annual");
    expect(normalizeBillingPeriod("yearly")).toBe("annual");
    expect(normalizeBillingPeriod(undefined)).toBe("monthly");
  });

  it("uses the annual price when annual billing is selected", () => {
    expect(
      resolvePlanAmountMicros(
        { price: "29.000000", annualPrice: "299.000000" },
        "annual",
      ),
    ).toBe(299_000_000);
    expect(
      resolvePlanAmountMicros(
        { price: "29.000000", annualPrice: "299.000000" },
        "monthly",
      ),
    ).toBe(29_000_000);
  });
});
