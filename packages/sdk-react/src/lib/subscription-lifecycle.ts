export type SubscriptionCancellationIntent = "scheduled";

type PlanChangeSuccessMessageInput = {
  mode?: string | null;
  selectedPlanName?: string | null;
  targetBillingPeriod?: string | null;
  previousBillingPeriod?: string | null;
  effectiveAtLabel?: string | null;
  prorationAmountDue?: string | null;
  prorationCredit?: string | null;
  walletCreditCreated?: number;
  pendingVerification?: boolean;
  alreadyScheduled?: boolean;
  replacedScheduledDowngrade?: boolean;
};

type CancellationRequestBodyInput = {
  intent: SubscriptionCancellationIntent;
  txHash?: string;
};

type CancellationFeedbackInput = {
  intent: SubscriptionCancellationIntent;
  mode?: string | null;
  effectiveAtLabel?: string | null;
  pendingVerification?: boolean;
};

export function buildPlanChangeSuccessMessage(
  input: PlanChangeSuccessMessageInput,
): string {
  const mode = input.mode ?? "";
  const prorationAmountDue =
    input.prorationAmountDue !== null && input.prorationAmountDue !== undefined
      ? Number(input.prorationAmountDue)
      : 0;
  const hasProrationCharge =
    Number.isFinite(prorationAmountDue) && prorationAmountDue > 0;
  const billingPeriodChanged =
    input.targetBillingPeriod &&
    input.previousBillingPeriod &&
    input.targetBillingPeriod !== input.previousBillingPeriod;

  if (input.alreadyScheduled) {
    if (
      mode === "next_renewal_on_chain" ||
      mode === "period_end" ||
      mode === "period_end_downgrade"
    ) {
      if (billingPeriodChanged) {
        return `This plan change is already scheduled. The updated renewal settings will take effect${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " at the next renewal"}.`;
      }
      return `This plan change is already scheduled${input.effectiveAtLabel ? ` for ${input.effectiveAtLabel}` : ""}.`;
    }

    if (mode === "immediate_prorated_upgrade") {
      return input.pendingVerification
        ? "This upgrade is already pending on-chain confirmation."
        : "This upgrade request is already in progress.";
    }
  }

  if (input.pendingVerification) {
    if (mode === "immediate_prorated_upgrade") {
      return `Upgrade submitted.${hasProrationCharge ? ` $${prorationAmountDue.toFixed(2)} will be charged after on-chain verification.` : " We’re waiting for on-chain confirmations before applying the new plan."}`;
    }

    if (
      mode === "next_renewal_on_chain" ||
      mode === "period_end" ||
      mode === "period_end_downgrade"
    ) {
      if (billingPeriodChanged) {
        return `Plan change submitted. We’re waiting for on-chain confirmations, then the updated renewal settings will take effect${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " at the next renewal"}.`;
      }
      return `Plan change submitted. We’re waiting for on-chain confirmations${input.effectiveAtLabel ? `, and the change will take effect on ${input.effectiveAtLabel}` : " before the scheduled change is applied"}.`;
    }
  }

  if (
    mode === "next_renewal_on_chain" ||
    mode === "period_end" ||
    mode === "period_end_downgrade"
  ) {
    if (billingPeriodChanged) {
      return `Plan change scheduled.${input.selectedPlanName ? ` ${input.selectedPlanName}` : " The updated subscription"} will take effect${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " on the next renewal"}.`;
    }
    if (input.selectedPlanName) {
      return `Downgrade scheduled. Your current access remains active until${input.effectiveAtLabel ? ` ${input.effectiveAtLabel}. Then your plan will switch to ${input.selectedPlanName}.` : " the end of the current billing period."}`;
    }
    return `Plan change scheduled.${input.selectedPlanName ? ` ${input.selectedPlanName} will take effect` : " The new plan will take effect"}${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " on the next renewal"}.`;
  }

  if (mode === "immediate_prorated_upgrade") {
    const prorationCredit =
      input.prorationCredit !== null &&
      input.prorationCredit !== undefined
        ? Number(input.prorationCredit)
        : 0;
    const hasCredit =
      Number.isFinite(prorationCredit) && prorationCredit > 0;

    const chargeNote = hasProrationCharge
      ? hasCredit
        ? ` $${prorationAmountDue.toFixed(2)} charged after $${prorationCredit.toFixed(2)} credit for unused time.`
        : ` $${prorationAmountDue.toFixed(2)} was charged for the remaining term.`
      : "";
    const downgradeNote = input.replacedScheduledDowngrade
      ? " The scheduled downgrade was removed."
      : "";
    const billingChangeNote = billingPeriodChanged
      ? ` Renewals are now on ${input.targetBillingPeriod} billing.`
      : "";
    return `Plan upgraded.${chargeNote}${downgradeNote}${billingChangeNote}`;
  }

  if (mode === "immediate_on_chain" && (input.walletCreditCreated ?? 0) > 0) {
    return `Plan changed. $${(input.walletCreditCreated ?? 0).toFixed(2)} wallet credit created.`;
  }

  if (mode === "immediate_on_chain") {
    return "Plan changed on-chain.";
  }

  return "Plan activated!";
}

export function buildCancellationRequestBody(
  input: CancellationRequestBodyInput,
): Record<string, unknown> {
  if (!input.txHash) return {};

  return {
    autopayControlTxHash: input.txHash,
  };
}

export function buildCancellationFeedback(input: CancellationFeedbackInput): {
  successMsg?: string;
  flashMsg?: string;
} {
  const mode = input.mode ?? "";

  if (mode === "cancel_at_period_end") {
    return {
      flashMsg: input.pendingVerification
        ? input.effectiveAtLabel
          ? `Cancellation submitted. Autopay is shutting down and your current plan stays active until ${input.effectiveAtLabel}.`
          : "Cancellation submitted. Autopay is shutting down and your current plan stays active until the end of the current billing period."
        : input.effectiveAtLabel
          ? `Cancellation scheduled. Your current plan stays active until ${input.effectiveAtLabel}.`
          : "Cancellation scheduled. Your current plan stays active until the end of the current billing period.",
    };
  }

  if (mode === "already_free") {
    return { flashMsg: "You are already on the Free plan." };
  }

  if (mode === "cancellation_completed") {
    return {
      flashMsg: "Your subscription has been cancelled and you have been moved to the Free plan.",
    };
  }

  if (mode === "downgrade_completed") {
    return {
      flashMsg: input.effectiveAtLabel
        ? `Your plan has been downgraded as of ${input.effectiveAtLabel}.`
        : "Your plan has been downgraded.",
    };
  }

  return {
    flashMsg:
      "Cancellation scheduled. Your current plan stays active until the end of the current billing period.",
  };
}
