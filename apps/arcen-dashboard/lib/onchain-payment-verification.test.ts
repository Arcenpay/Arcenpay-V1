import { describe, expect, it } from "vitest";
import {
  decimalToAtomicUnits,
  normalizeTxHash,
} from "@/lib/onchain-payment-verification";

describe("on-chain payment verification helpers", () => {
  it("normalizes only valid transaction hashes", () => {
    expect(normalizeTxHash("0x" + "a".repeat(64))).toBe(
      `0x${"a".repeat(64)}`,
    );
    expect(normalizeTxHash("  ")).toBeNull();
    expect(normalizeTxHash("0x1234")).toBeNull();
  });

  it("converts decimal amounts to atomic units", () => {
    expect(decimalToAtomicUnits("1")).toBe(1_000_000n);
    expect(decimalToAtomicUnits("1.25")).toBe(1_250_000n);
    expect(decimalToAtomicUnits("0.000001")).toBe(1n);
  });

  it("rejects invalid decimal strings", () => {
    expect(() => decimalToAtomicUnits("1.2.3")).toThrow(
      "Invalid decimal amount",
    );
    expect(() => decimalToAtomicUnits("abc")).toThrow(
      "Invalid decimal amount",
    );
  });
});
