export type SubscriptionCancellationIntent = "scheduled";

type PlanChangeSuccessMessageInput = {
  mode?: string | null;
  selectedPlanName?: string | null;
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

export function buildPlanChangeSuccessMessage(
  input: PlanChangeSuccessMessageInput,
): string {
  const mode = input.mode ?? "";

  if (
    mode === "next_renewal_on_chain" ||
    mode === "period_end" ||
    mode === "period_end_downgrade"
  ) {
    return `Plan change scheduled.${input.selectedPlanName ? ` ${input.selectedPlanName} will take effect` : " The new plan will take effect"}${input.effectiveAtLabel ? ` on ${input.effectiveAtLabel}` : " on the next renewal"}.`;
  }

  if (mode === "immediate_prorated_upgrade") {
    return `Plan upgraded.${input.prorationAmountDue ? ` $${Number(input.prorationAmountDue).toFixed(2)} was charged for the remaining term.` : ""}`;
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

  return {
    flashMsg:
      "Cancellation scheduled. Your current plan stays active until the end of the current billing period.",
  };
}
