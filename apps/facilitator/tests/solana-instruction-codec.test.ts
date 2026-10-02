import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  instructionDiscriminator,
  accountDiscriminator,
  parseSolanaSecretKey,
  decodeTokenAccountDelegation,
  findSubscriptionDelegatePda,
  encodeInitializeConfig,
  encodeCreatePlan,
  encodeUpdatePlan,
  encodeSubscribe,
  encodeExecute,
  encodeCancel,
  encodeChangePlan,
  encodeAuthorizeSettler,
  encodeFundSession,
  encodeSettle,
  encodeMigrateConfig,
  encodeWithdrawSession,
  findConfigPda,
  findPlanPda,
  findSubscriptionPda,
  findSubscriptionByWalletPda,
  findVaultAuthorityPda,
  findSessionPda,
  findSettlerPda,
} from "../src/services/solana-instruction-codec.js";

const PROGRAM_ID = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

function expectedDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

test("instructionDiscriminator matches sha256('global:<name>')[0..8]", () => {
  for (const name of ["execute", "cancel", "subscribe", "change_plan", "create_plan"]) {
    const d = instructionDiscriminator(name);
    assert.equal(d.length, 8);
    assert.deepEqual(d, expectedDiscriminator(name));
  }
});

test("execute encodes discriminator only — amount comes from the snapshot", () => {
  const data = encodeExecute();
  assert.equal(data.length, 8);
  assert.deepEqual(data, expectedDiscriminator("execute"));
});

test("subscribe encodes discriminator + token_id + amount (24 bytes)", () => {
  const data = encodeSubscribe(7, 1_000_000);
  assert.equal(data.length, 24);
  assert.deepEqual(data.subarray(0, 8), expectedDiscriminator("subscribe"));
  assert.equal(data.readBigUInt64LE(8), 7n);
  assert.equal(data.readBigUInt64LE(16), 1_000_000n);
});

test("cancel is discriminator-only (8 bytes)", () => {
  const data = encodeCancel();
  assert.equal(data.length, 8);
  assert.deepEqual(data, expectedDiscriminator("cancel"));
});

test("change_plan encodes the new plan id", () => {
  const data = encodeChangePlan(42);
  assert.equal(data.length, 16);
  assert.equal(data.readBigUInt64LE(8), 42n);
});

test("update_plan encodes price + interval + active flag", () => {
  const on = encodeUpdatePlan(999, 2_592_000, true);
  const off = encodeUpdatePlan(999, 2_592_000, false);
  assert.equal(on.length, 25);
  assert.equal(on.readBigUInt64LE(8), 999n);
  assert.equal(on.readBigInt64LE(16), 2_592_000n);
  assert.equal(on.readUInt8(24), 1);
  assert.equal(off.readUInt8(24), 0);
});

test("create_plan encodes plan id, price, interval, accepted token", () => {
  const mint = Keypair.generate().publicKey;
  const data = encodeCreatePlan(1, 2_500_000, 2_592_000, mint);
  assert.equal(data.length, 8 + 8 + 8 + 8 + 32);
  assert.equal(data.readBigUInt64LE(8), 1n);
  assert.equal(data.readBigUInt64LE(16), 2_500_000n);
  assert.equal(data.readBigInt64LE(24), 2_592_000n);
  assert.deepEqual(data.subarray(32, 64), mint.toBuffer());
});

test("initialize_config encodes treasury + fee bps", () => {
  const treasury = Keypair.generate().publicKey;
  const data = encodeInitializeConfig(treasury, 50);
  assert.equal(data.length, 8 + 32 + 8);
  assert.deepEqual(data.subarray(8, 40), treasury.toBuffer());
  assert.equal(data.readBigUInt64LE(40), 50n);
});

test("PDAs are deterministic and seed-scoped", () => {
  const [config] = findConfigPda(PROGRAM_ID);
  const [config2] = findConfigPda(PROGRAM_ID);
  assert.equal(config.toBase58(), config2.toBase58());

  const [plan1] = findPlanPda(PROGRAM_ID, 1);
  const [plan2] = findPlanPda(PROGRAM_ID, 2);
  assert.notEqual(plan1.toBase58(), plan2.toBase58());

  // Independent derivation must agree with the codec.
  const [manual] = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription"), (() => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(9n);
      return b;
    })()],
    new PublicKey(PROGRAM_ID),
  );
  const [sub] = findSubscriptionPda(PROGRAM_ID, 9);
  assert.equal(sub.toBase58(), manual.toBase58());

  const owner = Keypair.generate().publicKey;
  const [byWallet] = findSubscriptionByWalletPda(PROGRAM_ID, owner);
  const [manualByWallet] = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_wallet"), owner.toBuffer()],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(byWallet.toBase58(), manualByWallet.toBase58());
});

test("subscription delegate PDA is shared per (owner, mint), not per token id", () => {
  const owner = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const [delegate] = findSubscriptionDelegatePda(PROGRAM_ID, owner, mint);
  const [manual] = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_delegate"), owner.toBuffer(), mint.toBuffer()],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(delegate.toBase58(), manual.toBase58());

  // Same token account ⇒ same delegate (so a second subscription can't clobber
  // the first one), different mint ⇒ a different delegate.
  const [sameAgain] = findSubscriptionDelegatePda(PROGRAM_ID, owner, mint);
  assert.equal(delegate.toBase58(), sameAgain.toBase58());
  const [other] = findSubscriptionDelegatePda(
    PROGRAM_ID,
    owner,
    Keypair.generate().publicKey,
  );
  assert.notEqual(delegate.toBase58(), other.toBase58());
});

test("accountDiscriminator locks the on-chain Subscription discriminator", () => {
  const d = accountDiscriminator("Subscription");
  assert.equal(d.length, 8);
  // Verified against a live devnet Subscription account.
  assert.equal(d.toString("hex"), "40071a8766846221");
});

test("parseSolanaSecretKey rejects EVM keys and wrong-length secrets", () => {
  const kp = Keypair.generate();
  assert.deepEqual(
    parseSolanaSecretKey(JSON.stringify(Array.from(kp.secretKey))),
    kp.secretKey,
  );
  assert.throws(() => parseSolanaSecretKey("0x" + "ab".repeat(32)), /EVM key/);
  assert.throws(() => parseSolanaSecretKey("1111"), /64-byte/);
});

test("decodeTokenAccountDelegation reads the delegate and delegated amount", () => {
  const data = Buffer.alloc(165);
  Keypair.generate().publicKey.toBuffer().copy(data, 0);
  Keypair.generate().publicKey.toBuffer().copy(data, 32); // owner
  data.writeBigUInt64LE(1_000_000n, 64); // amount
  const delegate = Keypair.generate().publicKey;
  data.writeUInt32LE(1, 72); // delegate COption = Some
  delegate.toBuffer().copy(data, 76);
  data.writeUInt8(1, 108); // state
  data.writeUInt32LE(0, 109); // is_native = None
  data.writeBigUInt64LE(250_000n, 121); // delegated_amount
  data.writeUInt32LE(0, 129); // close_authority = None

  const decoded = decodeTokenAccountDelegation(data);
  assert.ok(decoded);
  assert.equal(decoded!.delegate, delegate.toBase58());
  assert.equal(decoded!.delegatedAmount, 250_000n);
  assert.equal(decoded!.amount, 1_000_000n);
});

test("session-vault instructions encode with the right layout", () => {
  const settler = Keypair.generate().publicKey;

  const auth = encodeAuthorizeSettler(settler);
  assert.equal(auth.length, 8 + 32);
  assert.deepEqual(auth.subarray(0, 8), expectedDiscriminator("authorize_settler"));
  assert.deepEqual(auth.subarray(8, 40), settler.toBuffer());

  const fund = encodeFundSession(7, 5_000_000);
  assert.equal(fund.length, 8 + 8 + 8);
  assert.deepEqual(fund.subarray(0, 8), expectedDiscriminator("fund_session"));
  assert.equal(fund.readBigUInt64LE(8), 7n);
  assert.equal(fund.readBigUInt64LE(16), 5_000_000n);

  const settle = encodeSettle(2_000_000, 3, new Uint8Array(32).fill(7));
  assert.equal(settle.length, 8 + 8 + 8 + 32 + 4 + 4);
  assert.deepEqual(settle.subarray(0, 8), expectedDiscriminator("settle"));
  assert.equal(settle.readBigUInt64LE(8), 2_000_000n);
  assert.equal(settle.readBigUInt64LE(16), 3n);
  assert.deepEqual(settle.subarray(24, 56), Buffer.alloc(32, 7));
  // Default (no proof): two empty Borsh Vec<u8> length prefixes.
  assert.equal(settle.readUInt32LE(56), 0);
  assert.equal(settle.readUInt32LE(60), 0);

  // Non-empty proof + public inputs: u32 LE length prefix + bytes for each.
  const withProof = encodeSettle(1n, 1n, new Uint8Array(32), new Uint8Array([1, 2, 3]), new Uint8Array([9]));
  assert.equal(withProof.length, 8 + 8 + 8 + 32 + 4 + 3 + 4 + 1);
  assert.equal(withProof.readUInt32LE(56), 3);
  assert.deepEqual(withProof.subarray(60, 63), Buffer.from([1, 2, 3]));
  assert.equal(withProof.readUInt32LE(63), 1);
  assert.equal(withProof[67], 9);

  const withdraw = encodeWithdrawSession(1_000_000);
  assert.equal(withdraw.length, 8 + 8);
  assert.deepEqual(withdraw.subarray(0, 8), expectedDiscriminator("withdraw_session"));
  assert.equal(withdraw.readBigUInt64LE(8), 1_000_000n);

  // migrate_config takes no arguments.
  const migrate = encodeMigrateConfig();
  assert.equal(migrate.length, 8);
  assert.deepEqual(migrate, expectedDiscriminator("migrate_config"));
});

test("session-vault PDAs derive deterministically and are seed-scoped", () => {
  const agent = Keypair.generate().publicKey;

  const [vaultA] = findVaultAuthorityPda(PROGRAM_ID);
  const [vaultB] = findVaultAuthorityPda(PROGRAM_ID);
  assert.equal(vaultA.toBase58(), vaultB.toBase58());

  const [session1] = findSessionPda(PROGRAM_ID, agent, 1);
  const [session2] = findSessionPda(PROGRAM_ID, agent, 2);
  assert.notEqual(session1.toBase58(), session2.toBase58());

  const [manualSession] = PublicKey.findProgramAddressSync(
    [Buffer.from("session"), agent.toBuffer(), (() => {
      const b = Buffer.alloc(8);
      b.writeBigUInt64LE(1n);
      return b;
    })()],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(session1.toBase58(), manualSession.toBase58());

  const settler = Keypair.generate().publicKey;
  const [record] = findSettlerPda(PROGRAM_ID, settler);
  const [manualRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("settler"), settler.toBuffer()],
    new PublicKey(PROGRAM_ID),
  );
  assert.equal(record.toBase58(), manualRecord.toBase58());
});
