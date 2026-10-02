// Reclaim a stale ArcenPay subscription for a wallet.
//
// The subscription PDAs are deterministic, so a program layout upgrade (or a
// failed finalize) can leave an account that permanently blocks the wallet from
// subscribing again. `close_subscription` (admin-only) closes the subscription
// and its wallet index, returning the rent to the admin.
//
// Usage:
//   npx tsx scripts/reclaim-subscription.ts \
//     --owner <wallet pubkey> [--owner <wallet> ...] \
//     [--url https://api.devnet.solana.com] \
//     [--keypair ~/.config/solana/arcenpay-devnet.json] \
//     [--program D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3]
//
// The admin keypair must be the program's config admin.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  encodeCloseSubscription,
  findConfigPda,
  findSubscriptionPda,
  findSubscriptionByWalletPda,
} from "../../../apps/facilitator/src/services/solana-instruction-codec.js";

function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((v, i) => {
    if (v === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  });
  return out;
}
function arg(name: string, fallback: string): string {
  return args(name)[0] ?? fallback;
}

const DEFAULT_PROGRAM = "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3";

async function main() {
  const url = arg("url", "https://api.devnet.solana.com");
  const keypairPath = arg("keypair", "~/.config/solana/arcenpay-devnet.json").replace(/^~/, homedir());
  const programId = new PublicKey(arg("program", DEFAULT_PROGRAM));
  const owners = args("owner");

  if (owners.length === 0) {
    console.error("--owner <wallet pubkey> is required (repeatable)");
    process.exit(1);
  }

  const admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(keypairPath, "utf8")) as number[]),
  );
  const connection = new Connection(url, "confirmed");
  const [config] = findConfigPda(programId);

  console.log(`cluster : ${url}`);
  console.log(`admin   : ${admin.publicKey.toBase58()}`);
  console.log(`program : ${programId.toBase58()}`);

  for (const ownerStr of owners) {
    const owner = new PublicKey(ownerStr);
    const [byWallet] = findSubscriptionByWalletPda(programId, owner);
    const link = await connection.getAccountInfo(byWallet);
    if (!link) {
      console.log(`\n• ${ownerStr} — no wallet index (already free)`);
      continue;
    }
    // SubscriptionByWallet: 8-byte discriminator | owner(32) | token_id(u64).
    const tokenId = link.data.readBigUInt64LE(40);
    const [subscription] = findSubscriptionPda(programId, tokenId);

    console.log(`\n… ${ownerStr} tokenId=${tokenId}`);
    const ix = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: admin.publicKey, isSigner: true, isWritable: true },
        { pubkey: subscription, isSigner: false, isWritable: true },
        { pubkey: byWallet, isSigner: false, isWritable: true },
      ],
      data: encodeCloseSubscription(tokenId, owner),
    });
    try {
      const sig = await sendAndConfirmTransaction(
        connection,
        new Transaction().add(ix),
        [admin],
        { commitment: "confirmed" },
      );
      console.log(`  ✓ reclaimed (tx ${sig})`);
    } catch (err) {
      console.error(`  ✗ failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
