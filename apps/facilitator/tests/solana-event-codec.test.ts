import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  decodeAnchorEventPayload,
  decodeAnchorEventBody,
  decodeSubscriptionRecord,
  decodePlanRecord,
  EVENT_DISCRIMINATORS,
  u64le,
} from "../src/services/solana-event-codec.js";

// ── Borsh helpers (mirror the Anchor struct layouts) ─────────────────────────

function discriminator(name: string): Buffer {
  return createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
}

function u8(v: number): Buffer {
  return Buffer.from([v]);
}

function u64(v: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
}

function i64(v: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(BigInt(v));
  return b;
}

function pubkey(b58: string): Buffer {
  return Buffer.from(new PublicKey(b58).toBuffer());
}

const base = { signature: "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb", slot: "123", timestamp: 1_700_000_000 };

test("EVENT_DISCRIMINATORS maps the six billing events", () => {
  assert.equal(EVENT_DISCRIMINATORS.size, 6);
  assert.equal(
    EVENT_DISCRIMINATORS.get(discriminator("SubscriptionMinted").toString("hex")),
    "minted",
  );
  assert.equal(
    EVENT_DISCRIMINATORS.get(discriminator("BillingExecuted").toString("hex")),
    "billing_executed",
  );
  assert.equal(
    EVENT_DISCRIMINATORS.get(discriminator("BillingSettled").toString("hex")),
    "billing_settled",
  );
});

test("decodes SubscriptionMinted (subscriber, token_id, plan_id, expiration)", () => {
  const subscriber = Keypair.generate().publicKey.toBase58();
  const body = Buffer.concat([
    pubkey(subscriber),
    u64(7),
    u64(42),
    i64(1_700_000_000),
  ]);
  const payload = Buffer.concat([discriminator("SubscriptionMinted"), body]);

  const event = decodeAnchorEventPayload(payload, base);
  assert.ok(event);
  assert.equal(event!.type, "minted");
  assert.equal(event!.subscriber, subscriber);
  assert.equal(event!.tokenId, "7");
  assert.equal(event!.planId, "42");
  assert.equal(event!.expiration, 1_700_000_000);
  assert.equal(event!.transactionHash, base.signature);
  assert.equal(event!.blockNumber, "123");
});

test("decodes SubscriptionRenewed (token_id, new_expiration, amount_paid)", () => {
  const body = Buffer.concat([u64(9n), i64(1_800_000_000), u64(5_000_000)]);
  const event = decodeAnchorEventBody("renewed", body, base);
  assert.ok(event);
  assert.equal(event!.tokenId, "9");
  assert.equal(event!.expiration, 1_800_000_000);
  assert.equal(event!.amountPaidMicros, "5000000");
});

test("decodes SubscriptionCancelled (token_id)", () => {
  const event = decodeAnchorEventBody("cancelled", u64(3), base);
  assert.ok(event);
  assert.equal(event!.tokenId, "3");
});

test("decodes SubscriptionPlanChanged (token_id, prev, new, expiration)", () => {
  const body = Buffer.concat([u64(3), u64(1), u64(2), i64(1_900_000_000)]);
  const event = decodeAnchorEventBody("plan_changed", body, base);
  assert.ok(event);
  assert.equal(event!.tokenId, "3");
  assert.equal(event!.previousPlanId, "1");
  assert.equal(event!.planId, "2");
  assert.equal(event!.expiration, 1_900_000_000);
});

test("decodes BillingExecuted with the fee split and reason", () => {
  const account = Keypair.generate().publicKey.toBase58();
  const merchant = Keypair.generate().publicKey.toBase58();
  const body = Buffer.concat([
    pubkey(account),
    pubkey(merchant),
    u64(11),
    u64(22),
    u8(1),
    u64(10_000_000),
    u64(9_950_000),
    u64(50_000),
    i64(1_700_000_123),
  ]);
  const event = decodeAnchorEventPayload(
    Buffer.concat([discriminator("BillingExecuted"), body]),
    base,
  );
  assert.ok(event);
  assert.equal(event!.type, "billing_executed");
  assert.equal(event!.account, account);
  assert.equal(event!.merchant, merchant);
  assert.equal(event!.tokenId, "11");
  assert.equal(event!.planId, "22");
  assert.equal(event!.billingReason, 1);
  assert.equal(event!.amountPaidMicros, "10000000");
  assert.equal(event!.merchantAmountMicros, "9950000");
  assert.equal(event!.protocolFeeMicros, "50000");
  assert.equal(event!.timestamp, 1_700_000_123);
});

test("decodes BillingSettled (session vault settlement)", () => {
  const agent = Keypair.generate().publicKey.toBase58();
  const body = Buffer.concat([
    u64(7), // session_id
    pubkey(agent), // agent
    u64(3), // call_count
    u64(2_000_000), // settlement_amount
    i64(1_700_000_000), // window_start
    i64(1_700_000_600), // window_end
  ]);
  const event = decodeAnchorEventPayload(
    Buffer.concat([discriminator("BillingSettled"), body]),
    base,
  );
  assert.ok(event);
  assert.equal(event!.type, "billing_settled");
  assert.equal(event!.tokenId, "7");
  assert.equal(event!.account, agent);
  assert.equal(event!.callCount, 3);
  assert.equal(event!.amountPaidMicros, "2000000");
});

test("returns null for an unknown discriminator", () => {
  const payload = Buffer.concat([Buffer.alloc(8, 0xff), u64(1)]);
  assert.equal(decodeAnchorEventPayload(payload, base), null);
});

test("returns null for a truncated payload", () => {
  const payload = Buffer.concat([Buffer.from("short"), u64(1)]);
  assert.equal(decodeAnchorEventPayload(payload, base), null);
});

test("decodes a Subscription account (full layout)", () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const data = Buffer.concat([
    Buffer.alloc(8), // account discriminator (skipped)
    pubkey(owner),
    u64(5), // token_id
    u64(2), // plan_id
    u8(0), // plan_tier
    i64(1_750_000_000), // expiration
    u8(1), // active
    i64(1_700_000_000), // minted_at
    i64(1_710_000_000), // last_renewed_at
    u64(1_000_000), // total_paid
    u8(254), // bump
  ]);
  const record = decodeSubscriptionRecord(data);
  assert.ok(record);
  assert.equal(record!.owner, owner);
  assert.equal(record!.tokenId, 5n);
  assert.equal(record!.planId, 2n);
  assert.equal(record!.planTier, 0);
  assert.equal(record!.expiration, 1_750_000_000n);
  assert.equal(record!.active, true);
  assert.equal(record!.mintedAt, 1_700_000_000n);
  assert.equal(record!.lastRenewedAt, 1_710_000_000n);
  assert.equal(record!.totalPaid, 1_000_000n);
});

test("decodeSubscriptionRecord returns null on a truncated account", () => {
  assert.equal(decodeSubscriptionRecord(Buffer.alloc(12)), null);
});

test("decodes a Plan account", () => {
  const provider = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const data = Buffer.concat([
    Buffer.alloc(8), // account discriminator
    u64(1), // plan_id
    Buffer.from(provider.toBuffer()), // provider
    u64(2_500_000), // price
    i64(2_592_000), // billing_interval
    Buffer.from(mint.toBuffer()), // accepted_token
    u8(1), // active
    u8(253), // bump
  ]);
  const plan = decodePlanRecord(data);
  assert.ok(plan);
  assert.equal(plan!.planId, 1n);
  assert.equal(plan!.provider, provider.toBase58());
  assert.equal(plan!.price, 2_500_000n);
  assert.equal(plan!.billingInterval, 2_592_000n);
  assert.equal(plan!.acceptedToken, mint.toBase58());
  assert.equal(plan!.active, true);
});

test("u64le encodes a bigint little-endian", () => {
  assert.equal(Buffer.from(u64le(1n)).readBigUInt64LE(), 1n);
  assert.equal(Buffer.from(u64le(9_100_001n)).readBigUInt64LE(), 9_100_001n);
});
