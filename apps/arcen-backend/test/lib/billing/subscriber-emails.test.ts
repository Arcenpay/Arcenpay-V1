import { describe, expect, it } from "vitest";
import { normalizeSubscriberWallet } from "../../../src/lib/billing/subscriber-emails";

describe("normalizeSubscriberWallet", () => {
  it("lowercases EVM addresses", () => {
    expect(
      normalizeSubscriberWallet("0xABCdef1234567890AbCdEf1234567890aBcDef12"),
    ).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("preserves Stellar addresses (case-sensitive base32)", () => {
    const stellar = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(normalizeSubscriberWallet(stellar)).toBe(stellar);
    expect(normalizeSubscriberWallet(`  ${stellar}  `)).toBe(stellar);
  });

  it("preserves Solana addresses (case-sensitive base58)", () => {
    const solana = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    expect(normalizeSubscriberWallet(solana)).toBe(solana);
  });

  it("rejects values that are not a valid address on any supported family", () => {
    expect(normalizeSubscriberWallet("not-a-wallet")).toBeNull();
    expect(normalizeSubscriberWallet("0x1234")).toBeNull();
    expect(normalizeSubscriberWallet("")).toBeNull();
    expect(normalizeSubscriberWallet("   ")).toBeNull();
    expect(normalizeSubscriberWallet(null)).toBeNull();
    expect(normalizeSubscriberWallet(undefined)).toBeNull();
  });
});
