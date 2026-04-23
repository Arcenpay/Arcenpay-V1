export type ProrationDirection =
  | "NONE"
  | "UPGRADE_PRORATION_CHARGE"
  | "DOWNGRADE_PRORATION_CREDIT";

export interface ProrationQuoteInput {
  currentAmountMicros: bigint;
  targetAmountMicros: bigint;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  effectiveAt?: Date;
}

export interface ProrationQuote {
  direction: ProrationDirection;
  totalPeriodSeconds: number;
  remainingSeconds: number;
  usedSeconds: number;
  remainingRatio: number;
  currentRemainingMicros: bigint;
  targetRemainingMicros: bigint;
  deltaMicros: bigint;
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function computeProrationQuote(
  input: ProrationQuoteInput,
): ProrationQuote {
  const effectiveAt = input.effectiveAt ?? new Date();
  const periodStartMs = input.currentPeriodStart.getTime();
  const periodEndMs = input.currentPeriodEnd.getTime();
  const effectiveMs = effectiveAt.getTime();

  const totalPeriodSeconds = Math.max(
    1,
    Math.floor((periodEndMs - periodStartMs) / 1000),
  );
  const remainingSeconds = Math.min(
    totalPeriodSeconds,
    clampNonNegative(Math.ceil((periodEndMs - effectiveMs) / 1000)),
  );
  const usedSeconds = Math.max(0, totalPeriodSeconds - remainingSeconds);
  const remainingRatio = remainingSeconds / totalPeriodSeconds;

  const currentRemainingMicros =
    (input.currentAmountMicros * BigInt(remainingSeconds)) /
    BigInt(totalPeriodSeconds);
  const targetRemainingMicros =
    (input.targetAmountMicros * BigInt(remainingSeconds)) /
    BigInt(totalPeriodSeconds);
  const deltaMicros = targetRemainingMicros - currentRemainingMicros;

  const direction: ProrationDirection =
    deltaMicros > 0n
      ? "UPGRADE_PRORATION_CHARGE"
      : deltaMicros < 0n
        ? "DOWNGRADE_PRORATION_CREDIT"
        : "NONE";

  return {
    direction,
    totalPeriodSeconds,
    remainingSeconds,
    usedSeconds,
    remainingRatio,
    currentRemainingMicros,
    targetRemainingMicros,
    deltaMicros,
  };
}
