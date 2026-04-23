import { describe, expect, it } from "vitest";
import { computeProrationQuote } from "@/lib/billing-proration";

describe("computeProrationQuote", () => {
  it("calculates an upgrade proration charge for the remaining period", () => {
    const quote = computeProrationQuote({
      currentAmountMicros: 10_000_000n,
      targetAmountMicros: 20_000_000n,
      currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      effectiveAt: new Date("2026-04-16T00:00:00.000Z"),
    });

    expect(quote.direction).toBe("UPGRADE_PRORATION_CHARGE");
    expect(quote.remainingSeconds).toBe(15 * 24 * 60 * 60);
    expect(quote.deltaMicros).toBe(5_000_000n);
  });

  it("calculates a downgrade proration credit for the remaining period", () => {
    const quote = computeProrationQuote({
      currentAmountMicros: 30_000_000n,
      targetAmountMicros: 10_000_000n,
      currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      effectiveAt: new Date("2026-04-21T00:00:00.000Z"),
    });

    expect(quote.direction).toBe("DOWNGRADE_PRORATION_CREDIT");
    expect(quote.remainingSeconds).toBe(10 * 24 * 60 * 60);
    expect(quote.deltaMicros).toBe(-6_666_667n);
  });

  it("returns no adjustment once the period has ended", () => {
    const quote = computeProrationQuote({
      currentAmountMicros: 10_000_000n,
      targetAmountMicros: 25_000_000n,
      currentPeriodStart: new Date("2026-04-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-05-01T00:00:00.000Z"),
      effectiveAt: new Date("2026-05-02T00:00:00.000Z"),
    });

    expect(quote.direction).toBe("NONE");
    expect(quote.remainingSeconds).toBe(0);
    expect(quote.deltaMicros).toBe(0n);
  });
});
