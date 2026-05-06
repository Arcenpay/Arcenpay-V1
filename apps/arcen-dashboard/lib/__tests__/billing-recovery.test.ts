import { describe, expect, it } from "vitest";
import { computeBillingRecoveryNextAttemptAt } from "@/lib/billing-recovery";

describe("billing recovery retry policy", () => {
  const now = new Date("2026-04-21T12:00:00.000Z");

  it("uses progressive backoff for repeated recovery failures", () => {
    expect(computeBillingRecoveryNextAttemptAt(1, now).toISOString()).toBe(
      "2026-04-21T12:05:00.000Z",
    );
    expect(computeBillingRecoveryNextAttemptAt(2, now).toISOString()).toBe(
      "2026-04-21T12:30:00.000Z",
    );
    expect(computeBillingRecoveryNextAttemptAt(3, now).toISOString()).toBe(
      "2026-04-21T14:00:00.000Z",
    );
  });

  it("caps the delay at the final retry tier", () => {
    expect(computeBillingRecoveryNextAttemptAt(9, now).toISOString()).toBe(
      "2026-04-21T20:00:00.000Z",
    );
  });
});
