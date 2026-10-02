#!/usr/bin/env node
/**
 * Provision a cluster so the ArcenPay Solana program is actually usable.
 *
 * `Subscribe` requires three SPL token accounts to already exist — the
 * subscriber's, the *provider's* and the *treasury's* — because the program
 * declares them as plain `InterfaceAccount<TokenAccount>` (no `init_if_needed`).
 * A freshly initialized program therefore fails on the first subscribe with
 * Anchor `AccountNotInitialized (3012)`.
 *
 * This script derives those accounts from on-chain state and creates any that
 * are missing. It is idempotent and non-destructive: it only ever *creates*
 * missing associated token accounts (paying their rent); it never transfers,
 * mints or changes program state.
 *
 * Usage:
 *   node scripts/provision-cluster.mjs \
 *     --url https://api.devnet.solana.com \
 *     --keypair ~/.config/solana/id.json \
 *     --program D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3 \
 *     --provider <provider wallet pubkey> \
 *     [--mint <spl mint>]        # defaults from the chain's USDC registry entry
 */
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

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// Chain registry default — devnet USDC (Circle).
const DEFAULT_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKeypair(path) {
  const resolved = path.replace(/^~/, homedir());
  const secret = JSON.parse(readFileSync(resolved, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function associatedTokenAddress(owner, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

/** Associated Token Account `Create` instruction (no data payload). */
function createAtaInstruction(payer, ata, owner, mint) {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

async function main() {
  const url = arg("url", "https://api.devnet.solana.com");
  const keypairPath = arg("keypair", "~/.config/solana/id.json");
  const programIdRaw = arg("program");
  const providerRaw = arg("provider");
  const mintRaw = arg("mint", DEFAULT_MINT);

  if (!programIdRaw) {
    console.error("--program <program id> is required");
    process.exit(1);
  }

  const connection = new Connection(url, "confirmed");
  const payer = loadKeypair(keypairPath);
  const programId = new PublicKey(programIdRaw);
  const mint = new PublicKey(mintRaw);

  console.log(`cluster      : ${url}`);
  console.log(`payer        : ${payer.publicKey.toBase58()}`);
  console.log(`program      : ${programId.toBase58()}`);
  console.log(`mint         : ${mint.toBase58()}`);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    programId,
  );
  const configInfo = await connection.getAccountInfo(configPda, "confirmed");
  if (!configInfo) {
    console.error(
      `\n✗ config PDA ${configPda.toBase58()} does not exist — run initialize_config first.`,
    );
    process.exit(1);
  }

  // Layout: 8-byte discriminator | authority(32) | treasury(32) | ...
  const treasury = new PublicKey(configInfo.data.subarray(40, 72));
  console.log(`config.authority: ${new PublicKey(configInfo.data.subarray(8, 40)).toBase58()}`);
  console.log(`config.treasury : ${treasury.toBase58()}`);

  const targets = [
    { label: "treasury", owner: treasury },
    ...(providerRaw
      ? [{ label: "provider", owner: new PublicKey(providerRaw) }]
      : [{ label: "provider", owner: null }]),
  ];

  let created = 0;
  let existing = 0;

  for (const { label, owner } of targets) {
    if (!owner) {
      console.log(
        `\n• ${label.padEnd(8)} skipped — pass --provider <pubkey> to provision it.`,
      );
      continue;
    }
    const ata = associatedTokenAddress(owner, mint);
    const info = await connection.getAccountInfo(ata, "confirmed");
    if (info) {
      console.log(`\n✓ ${label.padEnd(8)} ${ata.toBase58()} already exists`);
      existing += 1;
      continue;
    }

    console.log(`\n… ${label.padEnd(8)} creating ${ata.toBase58()}`);
    const tx = new Transaction().add(
      createAtaInstruction(payer.publicKey, ata, owner, mint),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: "confirmed",
    });
    console.log(`  created (tx ${sig})`);
    created += 1;
  }

  console.log(
    `\nDone. created=${created} existing=${existing}` +
      (providerRaw ? "" : "\n(Re-run with --provider <pubkey> to cover the provider account.)"),
  );
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message ?? err}`);
  process.exit(1);
});
