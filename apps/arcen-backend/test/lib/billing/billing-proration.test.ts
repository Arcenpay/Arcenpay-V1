import { describe, expect, it } from "vitest";

import { computeProrationSettlement } from "../../../src/lib/billing/billing-proration.js";

describe("computeProrationSettlement", () => {
  it("returns positive unused current-plan value and net due for an upgrade", () => {
    const result = computeProrationSettlement({
      currentAmountMicros: 10_000_000n,
      targetAmountMicros: 30_000_000n,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-01-31T00:00:00.000Z"),
      effectiveAt: new Date("2026-01-16T00:00:00.000Z"),
    });

    expect(result.unusedOldPlanCreditMicros).toBeGreaterThan(0n);
    expect(result.newPlanRemainingChargeMicros).toBeGreaterThan(
      result.unusedOldPlanCreditMicros,
    );
    expect(result.amountDueBeforeCreditsMicros).toBe(
      result.newPlanRemainingChargeMicros - result.unusedOldPlanCreditMicros,
    );
    expect(result.amountDueMicros).toBe(result.amountDueBeforeCreditsMicros);
    expect(result.creditCreatedMicros).toBe(0n);
  });

  it("applies existing billing credit before requiring a payment", () => {
    const result = computeProrationSettlement({
      currentAmountMicros: 10_000_000n,
      targetAmountMicros: 30_000_000n,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-01-31T00:00:00.000Z"),
      effectiveAt: new Date("2026-01-16T00:00:00.000Z"),
      availableBillingCreditMicros: 4_000_000n,
    });

    expect(result.amountDueBeforeCreditsMicros).toBeGreaterThan(0n);
    expect(result.billingCreditAppliedMicros).toBe(4_000_000n);
    expect(result.amountDueMicros).toBe(
      result.amountDueBeforeCreditsMicros - 4_000_000n,
    );
    expect(result.remainingBillingCreditMicros).toBe(0n);
  });

  it("creates wallet credit on a downgrade instead of a payment due", () => {
    const result = computeProrationSettlement({
      currentAmountMicros: 30_000_000n,
      targetAmountMicros: 10_000_000n,
      currentPeriodStart: new Date("2026-01-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-01-31T00:00:00.000Z"),
      effectiveAt: new Date("2026-01-16T00:00:00.000Z"),
      availableBillingCreditMicros: 2_000_000n,
    });

    expect(result.amountDueBeforeCreditsMicros).toBe(0n);
    expect(result.amountDueMicros).toBe(0n);
    expect(result.billingCreditAppliedMicros).toBe(0n);
    expect(result.creditCreatedMicros).toBeGreaterThan(0n);
    expect(result.totalCreditBalanceMicros).toBe(
      result.remainingBillingCreditMicros + result.creditCreatedMicros,
    );
  });
});
