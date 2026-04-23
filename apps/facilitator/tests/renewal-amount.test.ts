import test from "node:test";
import assert from "node:assert/strict";
import {
  microsToDecimalString,
  resolveSubscriptionChargeAmountMicros,
  resolveRenewalAmountMicros,
} from "../src/renewal-amount.js";

test("prefers the billed renewal amount when the event reports one", () => {
  const amount = resolveRenewalAmountMicros({
    eventAmountPaid: 2_500_000n,
    configuredMaxAmount: 9_999_999n,
  });

  assert.equal(amount, 2_500_000n);
});

test("falls back to configured maxAmount when renewed events report zero", () => {
  const amount = resolveRenewalAmountMicros({
    eventAmountPaid: 0n,
    configuredMaxAmount: 4_200_000n,
  });

  assert.equal(amount, 4_200_000n);
});

test("uses configured maxAmount for minted subscription charges when no event amount exists", () => {
  const amount = resolveSubscriptionChargeAmountMicros({
    configuredMaxAmount: 7_500_000n,
  });

  assert.equal(amount, 7_500_000n);
});

test("formats micros as a trimmed decimal string", () => {
  assert.equal(microsToDecimalString(4_200_000n), "4.2");
  assert.equal(microsToDecimalString(1_000_000n), "1");
  assert.equal(microsToDecimalString(1n), "0.000001");
});
