import { describe, expect, it } from "vitest";
import { WALLET_ADDRESS_REGEX } from "../../../src/lib/platform/chain-family.js";

// Shared by the email auth routes (`/auth/email/start`, `/auth/email/verify`)
// and the invoice route's `customerWallet`. A missing chain family here
// silently rejects that family's entire flow with `400 BAD_REQUEST`, so every
// family the platform supports must be covered.
describe("WALLET_ADDRESS_REGEX", () => {
  it("accepts EVM, Stellar and Solana addresses", () => {
    expect(WALLET_ADDRESS_REGEX.test("0x71C7656EC7ab88b098defB751B7401B5f6d8976F")).toBe(true);
    // Stellar account (G…) and contract (C…) ids.
    expect(
      WALLET_ADDRESS_REGEX.test("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    ).toBe(true);
    expect(
      WALLET_ADDRESS_REGEX.test("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"),
    ).toBe(true);
    // Solana base58 addresses (the Devnet program id + a wallet).
    expect(
      WALLET_ADDRESS_REGEX.test("D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3"),
    ).toBe(true);
    expect(
      WALLET_ADDRESS_REGEX.test("ELcbYWG16Nisg8qqKjs2C8zQNw7QZy4yUssKEPLyHYPW"),
    ).toBe(true);
  });

  it("rejects malformed or truncated addresses", () => {
    expect(WALLET_ADDRESS_REGEX.test("0x1234")).toBe(false);
    expect(WALLET_ADDRESS_REGEX.test("not-a-wallet")).toBe(false);
    expect(WALLET_ADDRESS_REGEX.test("")).toBe(false);
    // Base58 excludes 0/O/I/l — a Solana-length string using them is invalid.
    expect(WALLET_ADDRESS_REGEX.test("0OIl".repeat(8))).toBe(false);
  });
});
