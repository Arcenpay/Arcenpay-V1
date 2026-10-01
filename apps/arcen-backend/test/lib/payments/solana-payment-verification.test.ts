import { describe, expect, it } from "vitest";
import {
  computeRecipientTokenDelta,
  normalizeSolanaTxHash,
  type TokenBalanceEntry,
} from "../../../src/lib/payments/solana-payment-verification";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RECIPIENT = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const OTHER = "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2";

function entry(
  accountIndex: number,
  owner: string,
  amount: string,
  mint = MINT,
): TokenBalanceEntry {
  return { accountIndex, owner, mint, uiTokenAmount: { amount } };
}

describe("computeRecipientTokenDelta", () => {
  it("returns the credited amount for a single token account", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, RECIPIENT, "1000000")],
      [entry(1, RECIPIENT, "6000000")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(5_000_000n);
  });

  it("sums across multiple token accounts owned by the recipient", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, RECIPIENT, "1000"), entry(3, RECIPIENT, "2000")],
      [entry(1, RECIPIENT, "4000"), entry(3, RECIPIENT, "5000")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(6_000n);
  });

  it("ignores balances owned by other wallets", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, RECIPIENT, "0"), entry(2, OTHER, "0")],
      [entry(1, RECIPIENT, "500"), entry(2, OTHER, "999999")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(500n);
  });

  it("ignores balances for other mints", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, RECIPIENT, "0", "So11111111111111111111111111111111111111112")],
      [entry(1, RECIPIENT, "777", "So11111111111111111111111111111111111111112")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(0n);
  });

  it("handles a brand-new token account (post-only entry)", () => {
    const delta = computeRecipientTokenDelta([], [entry(4, RECIPIENT, "2500000")], {
      recipientWallet: RECIPIENT,
      mint: MINT,
    });
    expect(delta).toBe(2_500_000n);
  });

  it("returns a signed delta (debits are negative)", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, RECIPIENT, "9000000")],
      [entry(1, RECIPIENT, "4000000")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(-5_000_000n);
  });

  it("treats a missing uiTokenAmount as zero", () => {
    const delta = computeRecipientTokenDelta(
      [{ accountIndex: 1, owner: RECIPIENT, mint: MINT }],
      [entry(1, RECIPIENT, "1234")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(1_234n);
  });

  it("returns zero when the recipient is not involved", () => {
    const delta = computeRecipientTokenDelta(
      [entry(1, OTHER, "0")],
      [entry(1, OTHER, "5000")],
      { recipientWallet: RECIPIENT, mint: MINT },
    );
    expect(delta).toBe(0n);
  });
});

describe("normalizeSolanaTxHash", () => {
  it("accepts a base58 signature and trims whitespace", () => {
    const sig = "1".repeat(88);
    expect(normalizeSolanaTxHash(sig)).toBe(sig);
    expect(normalizeSolanaTxHash(`  ${sig}  `)).toBe(sig);
  });

  it("rejects EVM/Stellar-shaped hashes", () => {
    expect(
      normalizeSolanaTxHash("0x" + "a".repeat(64)),
    ).toBeNull();
    expect(normalizeSolanaTxHash("a".repeat(64))).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(normalizeSolanaTxHash("")).toBeNull();
    expect(normalizeSolanaTxHash("short")).toBeNull();
    expect(normalizeSolanaTxHash(null)).toBeNull();
    expect(normalizeSolanaTxHash(undefined)).toBeNull();
  });
});
