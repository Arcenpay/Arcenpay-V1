// Local-validator integration smoke for the ArcenPay Anchor program.
// Drives initialize_config -> create_plan -> subscribe using the SAME
// instruction encoders the facilitator uses, then decodes the emitted
// events with the SAME event codec.
import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  encodeInitializeConfig,
  encodeCreatePlan,
  encodeSubscribe,
  encodeExecute,
  encodeCancel,
  encodeChangePlan,
  findConfigPda,
  findPlanPda,
  findSubscriptionPda,
  findSubscriptionByWalletPda,
} from "../../../apps/facilitator/src/services/solana-instruction-codec.js";
import {
  decodeAnchorEventPayload,
  decodeSubscriptionRecord,
  PROGRAM_DATA_LOG_PREFIX,
} from "../../../apps/facilitator/src/services/solana-event-codec.js";

const RPC = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

const D = process.env.SOLANA_SCRATCH!;
const load = (name: string) =>
  Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${D}/${name}.json`, "utf8"))),
  );
const ata = (owner: PublicKey, mint: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()],
    ATA_PROGRAM,
  )[0];

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

function decodeTypes(logs: string[]): string[] {
  return logs
    .filter((l) => l.startsWith(PROGRAM_DATA_LOG_PREFIX))
    .map((l) =>
      decodeAnchorEventPayload(
        Buffer.from(l.slice(PROGRAM_DATA_LOG_PREFIX.length), "base64"),
        { signature: "local", slot: "0", timestamp: 0 },
      ),
    )
    .filter(Boolean)
    .map((e) => e!.type);
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const payer = load("id");
  const provider = load("provider");
  const treasury = load("treasury");
  const subscriber = load("subscriber");
  const mint = load("mint").publicKey;

  const programId = new PublicKey(process.env.PROGRAM_ID!);
  const [config] = findConfigPda(programId);

  const send = async (ixs: TransactionInstruction[], signers: Keypair[], label: string) => {
    const tx = new Transaction().add(...ixs);
    tx.feePayer = payer.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, ...signers], {
      commitment: "confirmed",
    });
    const txInfo = await connection.getTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
    console.log(`  ${label}: ${sig}`);
    return txInfo?.meta?.logMessages ?? [];
  };

  // 1. initialize_config (skip if already initialized — makes re-runs safe)
  const existingConfig = await connection.getAccountInfo(config);
  if (existingConfig) {
    console.log("• initialize_config skipped (already initialized)");
  } else {
    await send(
      [
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true },
            { pubkey: config, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: encodeInitializeConfig(treasury.publicKey, 50),
        }),
      ],
      [],
      "initialize_config",
    );
    console.log("✓ initialize_config");
  }

  // 2. create_plan(plan_id=1, price=10 USDC, interval=30d)
  const PLAN_ID = 1n;
  const PRICE = 10_000_000n;
  const [plan] = findPlanPda(programId, PLAN_ID);
  if (await connection.getAccountInfo(plan)) {
    console.log("• create_plan skipped (plan exists)");
  } else {
    await send(
      [
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: provider.publicKey, isSigner: true, isWritable: true },
            { pubkey: plan, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: encodeCreatePlan(PLAN_ID, PRICE, 2_592_000, mint),
        }),
      ],
      [provider],
      "create_plan",
    );
    console.log("✓ create_plan");
  }

  // 3. subscribe(token_id=1, amount=10 USDC)
  const TOKEN_ID = 1n;
  const AMOUNT = 10_000_000n;
  const [subscription] = findSubscriptionPda(programId, TOKEN_ID);
  const [byWallet] = findSubscriptionByWalletPda(programId, subscriber.publicKey);
  const subAta = ata(subscriber.publicKey, mint);
  const provAta = ata(provider.publicKey, mint);
  const treasAta = ata(treasury.publicKey, mint);

  const balanceOf = async (addr: PublicKey) => {
    const info = await connection.getTokenAccountBalance(addr);
    return BigInt(info.value.amount);
  };
  const subBefore = await balanceOf(subAta);
  const provBefore = await balanceOf(provAta);
  const treasBefore = await balanceOf(treasAta);

  const logs = await send(
    [
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: plan, isSigner: false, isWritable: false },
          { pubkey: subscriber.publicKey, isSigner: true, isWritable: true },
          { pubkey: subscription, isSigner: false, isWritable: true },
          { pubkey: byWallet, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: subAta, isSigner: false, isWritable: true },
          { pubkey: provAta, isSigner: false, isWritable: true },
          { pubkey: treasAta, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeSubscribe(TOKEN_ID, AMOUNT),
      }),
    ],
    [subscriber],
    "subscribe",
  );
  console.log("✓ subscribe");

  // 4. Assert balances moved with a 50bps fee split.
  const fee = (AMOUNT * 50n) / 10_000n;
  const net = AMOUNT - fee;
  assert((await balanceOf(subAta)) === subBefore - AMOUNT, "subscriber debited full amount");
  assert((await balanceOf(provAta)) === provBefore + net, "provider credited net amount");
  assert((await balanceOf(treasAta)) === treasBefore + fee, "treasury credited fee");
  console.log(`✓ balances: fee=${fee} net=${net}`);

  // 5. Decode the on-chain Subscription account with the shared decoder.
  const acct = await connection.getAccountInfo(subscription);
  const record = acct ? decodeSubscriptionRecord(acct.data) : null;
  assert(record, "subscription account decodes");
  assert(record!.owner === subscriber.publicKey.toBase58(), "owner is subscriber");
  assert(record!.tokenId === TOKEN_ID, "token id");
  assert(record!.planId === PLAN_ID, "plan id");
  assert(record!.active === true, "active");
  assert(record!.totalPaid === AMOUNT, "total paid");
  console.log(`✓ subscription account: plan=${record!.planId} exp=${record!.expiration}`);

  // 6. Decode emitted events with the shared event codec.
  const events = logs
    .filter((l) => l.startsWith(PROGRAM_DATA_LOG_PREFIX))
    .map((l) =>
      decodeAnchorEventPayload(Buffer.from(l.slice(PROGRAM_DATA_LOG_PREFIX.length), "base64"), {
        signature: "local",
        slot: "0",
        timestamp: 0,
      }),
    )
    .filter(Boolean);
  const types = events.map((e) => e!.type);
  assert(types.includes("minted"), "SubscriptionMinted emitted");
  assert(types.includes("billing_executed"), "BillingExecuted emitted");
  const billing = events.find((e) => e!.type === "billing_executed")!;
  assert(billing.billingReason === 0, "billing reason 0 (activation)");
  assert(BigInt(billing.amountPaidMicros!) === AMOUNT, "event gross amount");
  assert(BigInt(billing.merchantAmountMicros!) === net, "event merchant amount");
  assert(BigInt(billing.protocolFeeMicros!) === fee, "event protocol fee");
  console.log(`✓ events decoded: ${types.join(", ")}`);

  // 7. Re-subscribing the same token id must fail (PDA already exists).
  let rejected = false;
  try {
    await send(
      [
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: plan, isSigner: false, isWritable: false },
            { pubkey: subscriber.publicKey, isSigner: true, isWritable: true },
            { pubkey: subscription, isSigner: false, isWritable: true },
            { pubkey: byWallet, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: subAta, isSigner: false, isWritable: true },
            { pubkey: provAta, isSigner: false, isWritable: true },
            { pubkey: treasAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: encodeSubscribe(TOKEN_ID, AMOUNT),
        }),
      ],
      [subscriber],
      "subscribe-again",
    );
  } catch {
    rejected = true;
  }
  assert(rejected, "duplicate subscribe rejected");
  console.log("✓ duplicate subscribe rejected");

  // 8. create a second plan and change_plan to it
  const PLAN2 = 2n;
  const [plan2] = findPlanPda(programId, PLAN2);
  await send(
    [
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: provider.publicKey, isSigner: true, isWritable: true },
          { pubkey: plan2, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: encodeCreatePlan(PLAN2, 5_000_000, 2_592_000, mint),
      }),
    ],
    [provider],
    "create_plan#2",
  );

  const changeLogs = await send(
    [
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: subscription, isSigner: false, isWritable: true },
          { pubkey: plan2, isSigner: false, isWritable: false },
          { pubkey: subscriber.publicKey, isSigner: true, isWritable: false },
        ],
        data: encodeChangePlan(PLAN2),
      }),
    ],
    [subscriber],
    "change_plan",
  );
  const afterChange = decodeSubscriptionRecord(
    (await connection.getAccountInfo(subscription))!.data,
  )!;
  assert(afterChange.planId === PLAN2, "plan id updated to 2");
  assert(
    decodeTypes(changeLogs).includes("plan_changed"),
    "SubscriptionPlanChanged emitted",
  );
  console.log("✓ change_plan");

  // 9. execute before the billing interval elapses must be rejected
  let renewRejected = false;
  try {
    await send(
      [
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: config, isSigner: false, isWritable: false },
            { pubkey: plan2, isSigner: false, isWritable: false },
            { pubkey: subscription, isSigner: false, isWritable: true },
            { pubkey: subscriber.publicKey, isSigner: true, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: subAta, isSigner: false, isWritable: true },
            { pubkey: provAta, isSigner: false, isWritable: true },
            { pubkey: treasAta, isSigner: false, isWritable: true },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
          ],
          data: encodeExecute(5_000_000),
        }),
      ],
      [subscriber],
      "execute-early",
    );
  } catch {
    renewRejected = true;
  }
  assert(renewRejected, "early renewal rejected by MIN_BILLING_INTERVAL guard");
  console.log("✓ execute rejected before the billing interval");

  // 10. cancel
  const cancelLogs = await send(
    [
      new TransactionInstruction({
        programId,
        keys: [
          { pubkey: subscription, isSigner: false, isWritable: true },
          { pubkey: subscriber.publicKey, isSigner: true, isWritable: false },
        ],
        data: encodeCancel(),
      }),
    ],
    [subscriber],
    "cancel",
  );
  const afterCancel = decodeSubscriptionRecord(
    (await connection.getAccountInfo(subscription))!.data,
  )!;
  assert(afterCancel.active === false, "subscription inactive after cancel");
  assert(
    decodeTypes(cancelLogs).includes("cancelled"),
    "SubscriptionCancelled emitted",
  );
  console.log("✓ cancel");

  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
