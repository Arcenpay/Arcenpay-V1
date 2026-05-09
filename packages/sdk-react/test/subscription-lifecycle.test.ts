import { describe, expect, it } from "vitest";
import {
  buildCancellationFeedback,
  buildCancellationRequestBody,
  buildPlanChangeSuccessMessage,
} from "../src/lib/subscription-lifecycle";

describe("subscription lifecycle helpers", () => {
  it("returns a scheduled downgrade message for period-end plan changes", () => {
    expect(
      buildPlanChangeSuccessMessage({
        mode: "period_end",
        selectedPlanName: "Starter",
        effectiveAtLabel: "May 31, 2026",
      }),
    ).toBe("Plan change scheduled. Starter will take effect on May 31, 2026.");
  });

  it("builds the scheduled cancellation request payload", () => {
    expect(
      buildCancellationRequestBody({
        intent: "scheduled",
        txHash: "0xdef",
      }),
    ).toEqual({
      autopayControlTxHash: "0xdef",
    });
  });

  it("returns scheduled cancellation feedback with the renewal date", () => {
    expect(
      buildCancellationFeedback({
        intent: "scheduled",
        mode: "cancel_at_period_end",
        effectiveAtLabel: "June 1, 2026",
      }),
    ).toEqual({
      flashMsg:
        "Cancellation scheduled. Your current plan stays active until June 1, 2026.",
    });
  });
});
