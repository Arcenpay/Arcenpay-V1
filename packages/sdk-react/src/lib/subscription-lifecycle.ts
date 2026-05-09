export type SubscriptionCancellationIntent = "scheduled";

type PlanChangeSuccessMessageInput = {
  mode?: string | null;
  selectedPlanName?: string | null;
  targetBillingPeriod?: string | null;
  previousBillingPeriod?: string | null;
  effectiveAtLabel?: string | null;
  prorationAmountDue?: string | null;
  walletCreditCreated?: number;
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

function billingPeriodLabel(period: string | null | undefined): string {
  if (period === "annual" || period === "yearly") return "Annual";
  return "Monthly";
}

export function buildPlanChangeSuccessMessage(
  input: PlanChangeSuccessMessageInput,
): string {
  const mode = input.mode ?? "";
  const targetBillingPeriodDisplay = billingPeriodLabel(input.targetBillingPeriod);
  const previousBillingPeriodDisplay = billingPeriodLabel(input.previousBillingPeriod);

  if (
    mode === "next_renewal_on_chain" ||
    mode === "period_end" ||
    mode === "period_end_downgrade"
  ) {
    if (
      input.targetBillingPeriod &&
      input.previousBillingPeriod &&
      input.targetBillingPeriod !== input.previousBillingPeriod
    ) {
      return `Plan change scheduled.${input.selectedPlanName ? ` ${input.selectedPlanName}` : ""} ${targetBillingPeriodDisplay} billing will take effect${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " on the next renewal"}.`;
    }
    return `Plan change scheduled.${input.selectedPlanName ? ` ${input.selectedPlanName} will take effect` : " The new plan will take effect"}${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " on the next renewal"}.`;
  }

  if (mode === "immediate_prorated_upgrade") {
    const billingChangeNote =
      input.targetBillingPeriod &&
      input.previousBillingPeriod &&
      input.targetBillingPeriod !== input.previousBillingPeriod
        ? ` Billing changed to ${targetBillingPeriodDisplay}.`
        : "";
    return `Plan upgraded.${input.prorationAmountDue ? ` $${Number(input.prorationAmountDue).toFixed(2)} was charged for the remaining term.` : ""}${billingChangeNote}`;
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
