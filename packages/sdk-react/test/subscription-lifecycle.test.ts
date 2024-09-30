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
    ).toBe(
      "Downgrade scheduled. Your current access remains active until May 31, 2026. Then your plan will switch to Starter.",
    );
  });

  it("returns a scheduled message when billing period changes from monthly to annual", () => {
    expect(
      buildPlanChangeSuccessMessage({
        mode: "period_end",
        selectedPlanName: "Pro",
        targetBillingPeriod: "annual",
        previousBillingPeriod: "monthly",
        effectiveAtLabel: "May 31, 2026",
      }),
    ).toBe("Plan change scheduled. Pro will take effect on May 31, 2026.");
  });

  it("returns an upgrade message with billing period change note", () => {
    expect(
      buildPlanChangeSuccessMessage({
        mode: "immediate_prorated_upgrade",
        selectedPlanName: "Enterprise",
        targetBillingPeriod: "annual",
        previousBillingPeriod: "monthly",
        prorationAmountDue: "50.00",
      }),
    ).toBe(
      "Plan upgraded. $50.00 was charged for the remaining term. Renewals are now on annual billing.",
    );
  });

  it("returns an upgrade message without billing period change when periods match", () => {
    expect(
      buildPlanChangeSuccessMessage({
        mode: "immediate_prorated_upgrade",
        selectedPlanName: "Enterprise",
        targetBillingPeriod: "monthly",
        previousBillingPeriod: "monthly",
        prorationAmountDue: "50.00",
      }),
    ).toBe("Plan upgraded. $50.00 was charged for the remaining term.");
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

  it("returns empty body when no txHash", () => {
    expect(
      buildCancellationRequestBody({
        intent: "scheduled",
      }),
    ).toEqual({});
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

  it("returns already free feedback", () => {
    expect(
      buildCancellationFeedback({
        intent: "scheduled",
        mode: "already_free",
      }),
    ).toEqual({
      flashMsg: "You are already on the Free plan.",
    });
  });

  it("returns cancellation completed feedback", () => {
    expect(
      buildCancellationFeedback({
        intent: "scheduled",
        mode: "cancellation_completed",
      }),
    ).toEqual({
      flashMsg: "Your subscription has been cancelled and you have been moved to the Free plan.",
    });
  });

  it("returns downgrade completed feedback", () => {
    expect(
      buildCancellationFeedback({
        intent: "scheduled",
        mode: "downgrade_completed",
        effectiveAtLabel: "May 31, 2026",
      }),
    ).toEqual({
      flashMsg: "Your plan has been downgraded as of May 31, 2026.",
    });
  });

  it("returns pending verification feedback for cancellation", () => {
    expect(
      buildCancellationFeedback({
        intent: "scheduled",
        mode: "cancel_at_period_end",
        effectiveAtLabel: "June 1, 2026",
        pendingVerification: true,
      }),
    ).toEqual({
      flashMsg:
        "Cancellation submitted. Autopay is shutting down and your current plan stays active until June 1, 2026.",
    });
  });
});
