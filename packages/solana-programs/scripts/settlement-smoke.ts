// End-to-end smoke for the facilitator's Solana settlement writer against a
// local validator: initialize_config → authorize_settler → fund_session, then
// drive SettlementWriterService.settleForSigner and assert the vault moved
// funds to the provider via the Anchor `settle` instruction.
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
  encodeAuthorizeSettler,
  encodeFundSession,
  findConfigPda,
  findVaultAuthorityPda,
  findSettlerPda,
  findSessionPda,
  findAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "../../../apps/facilitator/src/services/solana-instruction-codec.js";
import { decodeSessionRecord } from "../../../apps/facilitator/src/services/solana-event-codec.js";
import { SettlementWriterService } from "../../../apps/facilitator/src/services/settlement-writer.js";

const RPC = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const D = process.env.SOLANA_SCRATCH!;
const PROGRAM_ID = process.env.PROGRAM_ID!;

function load(name: string): Keypair {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${D}/${name}.json`, "utf8"))),
  );
}
const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({
  pubkey,
  isSigner,
  isWritable,
});

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const payer = load("id");
  const subscriber = load("subscriber");
  const provider = load("provider");
  const treasury = load("treasury");
  const settler = load("settler");
  const mint = load("mint").publicKey;
  const programId = new PublicKey(PROGRAM_ID);

  const send = async (ix: TransactionInstruction, signers: Keypair[]) => {
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    return sendAndConfirmTransaction(connection, tx, [payer, ...signers], {
      commitment: "confirmed",
    });
  };

  const [config] = findConfigPda(programId);
  if (await connection.getAccountInfo(config)) {
    console.log("• initialize_config skipped (already initialized)");
  } else {
    await send(
      new TransactionInstruction({
        programId,
        keys: [
          meta(payer.publicKey, true, true),
          meta(config, false, true),
          meta(SystemProgram.programId, false, false),
        ],
        data: encodeInitializeConfig(treasury.publicKey, 50n),
      }),
      [],
    );
  }

  const [settlerRecord] = findSettlerPda(programId, settler.publicKey);
  if (await connection.getAccountInfo(settlerRecord)) {
    console.log("• authorize_settler skipped (already authorized)");
  } else {
    await send(
      new TransactionInstruction({
        programId,
        keys: [
          meta(config, false, false),
          meta(payer.publicKey, true, true),
          meta(settlerRecord, false, true),
          meta(settler.publicKey, false, false),
          meta(SystemProgram.programId, false, false),
        ],
        data: encodeAuthorizeSettler(settler.publicKey),
      }),
      [],
    );
  }

  const SESSION_ID = 7n;
  const [vaultAuthority] = findVaultAuthorityPda(programId);
  const [session] = findSessionPda(programId, subscriber.publicKey, SESSION_ID);
  const subscriberAta = findAssociatedTokenAddress(subscriber.publicKey, mint);
  const vaultAta = findAssociatedTokenAddress(vaultAuthority, mint);
  await send(
    new TransactionInstruction({
      programId,
      keys: [
        meta(config, false, false),
        meta(vaultAuthority, false, false),
        meta(subscriber.publicKey, true, true),
        meta(session, false, true),
        meta(mint, false, false),
        meta(subscriberAta, false, true),
        meta(vaultAta, false, true),
        meta(TOKEN_PROGRAM_ID, false, false),
        meta(SystemProgram.programId, false, false),
      ],
      data: encodeFundSession(SESSION_ID, 5_000_000n),
    }),
    [subscriber],
  );
  console.log("setup: config + settler + funded session OK");

  // Drive the real writer.
  const writer = new SettlementWriterService({
    rpcUrl: RPC,
    chainId: 9_100_001,
    privateKey: readFileSync(`${D}/settler.json`, "utf8"),
    sessionVaultAddress: PROGRAM_ID,
    providerAddress: provider.publicKey.toBase58(),
  });

  if (!(await writer.isSignerAuthorized())) throw new Error("settler not authorized");

  const providerAta = findAssociatedTokenAddress(provider.publicKey, mint);
  const before = BigInt(
    (await connection.getTokenAccountBalance(providerAta)).value.amount,
  );

  const result = await writer.settleForSigner({
    signer: subscriber.publicKey.toBase58(),
    amount: 2_000_000n,
    sessionIdHint: "7",
    providerAddress: provider.publicKey.toBase58(),
  });

  const after = BigInt(
    (await connection.getTokenAccountBalance(providerAta)).value.amount,
  );
  const sessionInfo = await connection.getAccountInfo(session);
  const record = decodeSessionRecord(sessionInfo!.data);
  if (!record) throw new Error("failed to decode session");

  console.log(`settle tx: ${result.transactionHash}`);
  console.log(`provider credited: ${after - before}`);
  console.log(`session balance: ${record.balance} totalSettled: ${record.totalSettled}`);

  if (after - before !== 2_000_000n) throw new Error("provider not credited 2 USDC");
  if (record.balance !== 3_000_000n) throw new Error("session balance should be 3 USDC");
  if (record.totalSettled !== 2_000_000n) throw new Error("totalSettled wrong");
  console.log("SETTLEMENT SMOKE OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
