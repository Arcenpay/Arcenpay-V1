import { describe, expect, it } from "vitest";
import { normalizeWallet } from "../../../src/lib/billing/utils.js";

describe("normalizeWallet", () => {
  it("lowercases EVM addresses starting with 0x or 0X", () => {
    expect(normalizeWallet("0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B")).toBe(
      "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
    );
    expect(normalizeWallet("0XAB5801A7D398351B8BE11C439E05C5B3259AEC9B")).toBe(
      "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
    );
  });

  it("preserves casing for Stellar base32 account addresses (G...)", () => {
    const stellarAddress = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    expect(normalizeWallet(stellarAddress)).toBe(stellarAddress);
  });

  it("preserves casing for Stellar base32 contract IDs (C...)", () => {
    const contractId = "CAF4VS5OMM6DW5ZN5JFJH4U2RJD6DODZYBHNXMTS6RSUMPDO3T4C73S7";
    expect(normalizeWallet(contractId)).toBe(contractId);
  });

  it("trims whitespace", () => {
    expect(normalizeWallet("  0x1234abcd  ")).toBe("0x1234abcd");
    expect(
      normalizeWallet("  GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5  "),
    ).toBe("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  });

  it("returns null for non-string or empty input", () => {
    expect(normalizeWallet(null)).toBeNull();
    expect(normalizeWallet(undefined)).toBeNull();
    expect(normalizeWallet("")).toBeNull();
    expect(normalizeWallet("   ")).toBeNull();
  });
});
