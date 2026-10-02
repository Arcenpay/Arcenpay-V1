import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  isRenewalDue,
  SolanaRenewalDriver,
  SUBSCRIPTION_DISCRIMINATOR_BASE58,
} from "../src/services/solana-renewal-driver.js";
import {
  decodeBase58,
  encodeBase58,
} from "../src/services/solana-instruction-codec.js";

// Solana devnet — the only chain where the ArcenPay program id is configured.
const CHAIN_ID = 9_100_001;

test("isRenewalDue compares expiration against now", () => {
  const now = 1_700_000_000;
  assert.equal(isRenewalDue(BigInt(now - 1), now), true);
  assert.equal(isRenewalDue(BigInt(now), now), true);
  assert.equal(isRenewalDue(BigInt(now + 1), now), false);
  assert.equal(isRenewalDue(0n, now), true);
});

test("discovery filter is the Subscription account discriminator", () => {
  assert.equal(
    Buffer.from(decodeBase58(SUBSCRIPTION_DISCRIMINATOR_BASE58)).toString("hex"),
    "40071a8766846221",
  );
});

test("driver refuses to start without a relayer key", () => {
  assert.throws(
    () => new SolanaRenewalDriver({ chainId: CHAIN_ID, relayerKey: "" }),
    /relayer key/,
  );
});

test("driver rejects an EVM-format key with an actionable message", () => {
  assert.throws(
    () =>
      new SolanaRenewalDriver({
        chainId: CHAIN_ID,
        relayerKey: "0x" + "ab".repeat(32),
      }),
    /EVM key/,
  );
});

test("driver derives the relayer address from a base58 keypair secret", () => {
  const kp = Keypair.generate();
  const driver = new SolanaRenewalDriver({
    chainId: CHAIN_ID,
    relayerKey: encodeBase58(kp.secretKey),
  });
  assert.equal(driver.getRelayerAddress(), kp.publicKey.toBase58());
  assert.equal(driver.getStats().relayer, kp.publicKey.toBase58());
  assert.equal(driver.getStats().parked, 0);
  assert.equal(driver.getStats().running, false);
});
