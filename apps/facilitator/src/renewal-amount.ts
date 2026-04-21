export function resolveRenewalAmountMicros(input: {
  eventAmountPaid?: bigint | null;
  configuredMaxAmount?: bigint | null;
}): bigint {
  if (input.eventAmountPaid && input.eventAmountPaid > 0n) {
    return input.eventAmountPaid;
  }

  if (input.configuredMaxAmount && input.configuredMaxAmount > 0n) {
    return input.configuredMaxAmount;
  }

  return 0n;
}

export function microsToDecimalString(amountMicros: bigint): string {
  const isNegative = amountMicros < 0n;
  const normalized = isNegative ? -amountMicros : amountMicros;
  const whole = normalized / 1_000_000n;
  const fraction = String(normalized % 1_000_000n).padStart(6, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const amount = trimmedFraction ? `${whole}.${trimmedFraction}` : `${whole}`;
  return isNegative ? `-${amount}` : amount;
}
