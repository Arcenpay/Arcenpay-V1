// Authorize an address to settle ZKVUB usage sessions (program admin only).
//
// The ArcenPay program's `settle` instruction requires the signer to have a
// `["settler", address]` registry PDA (created by `authorize_settler`).
// Without it the facilitator's SettlementWriterService constructs fine but
// every settlement would fail.
//
// Usage:
//   npx tsx scripts/authorize-settler.ts \
//     --settler <pubkey> \
//     [--url https://api.devnet.solana.com] \
//     [--keypair ~/.config/solana/arcenpay-devnet.json] \
//     [--program D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
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
  encodeAuthorizeSettler,
  findConfigPda,
  findSettlerPda,
} from "../../../apps/facilitator/src/services/solana-instruction-codec.js";

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
const arg = (name: string, fallback: string) => args(name)[0] ?? fallback;

async function main() {
  const url = arg("url", "https://api.devnet.solana.com");
  const keypairPath = arg("keypair", "~/.config/solana/arcenpay-devnet.json").replace(/^~/, homedir());
  const programId = new PublicKey(arg("program", "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3"));
  const settlerRaw = args("settler")[0];
  if (!settlerRaw) {
    console.error("--settler <pubkey> is required");
    process.exit(1);
  }
  const settler = new PublicKey(settlerRaw);

  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
  );
  const connection = new Connection(url, "confirmed");
  const [config] = findConfigPda(programId);
  const [settlerRecord] = findSettlerPda(programId, settler);

  const existing = await connection.getAccountInfo(settlerRecord);
  if (existing) {
    console.log(`✓ ${settler.toBase58()} is already an authorized settler`);
    return;
  }

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: admin.publicKey, isSigner: true, isWritable: true },
      { pubkey: settlerRecord, isSigner: false, isWritable: true },
      { pubkey: settler, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeAuthorizeSettler(settler),
  });

  const sig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(ix),
    [admin],
    { commitment: "confirmed" },
  );
  console.log(`✓ authorized settler ${settler.toBase58()} (tx ${sig})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
