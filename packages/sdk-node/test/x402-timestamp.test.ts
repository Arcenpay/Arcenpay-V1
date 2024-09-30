import { describe, it, expect } from "vitest";
import { normalizePaymentTimestampMs } from "../src/middleware/x402";

describe("x402 timestamp normalization", () => {
  it("normalizes unix seconds to milliseconds", () => {
    const seconds = 1_710_000_000n;
    expect(normalizePaymentTimestampMs(seconds)).toBe(1_710_000_000_000n);
  });

  it("keeps unix milliseconds unchanged", () => {
    const milliseconds = 1_710_000_000_123n;
    expect(normalizePaymentTimestampMs(milliseconds)).toBe(milliseconds);
  });

  it("treats threshold values as milliseconds", () => {
    const threshold = 1_000_000_000_000n;
    expect(normalizePaymentTimestampMs(threshold)).toBe(threshold);
  });
});
