#!/usr/bin/env node
/**
 * One-time program setup: `initialize_config` + the treasury's USDC token account.
 *
 * Without these two things the program cannot be used:
 *   - no config  -> the program does not know the treasury or the fee rate
 *   - no treasury ATA -> the first `Subscribe` fails with AccountNotInitialized
 *
 * Idempotent: if the config already exists it says so and skips; it only
 * creates the associated token account when it is missing.
 *
 * Usage:
 *   node scripts/setup-program.mjs \
 *     --url https://api.mainnet-beta.solana.com \
 *     --keypair ~/.config/solana/arcenpay-mainnet.json \
 *     --treasury 3hoVJKNDP9zpHvxizcKGYzZL2ZeTaBTZ2m2p68Wi9Tmv \
 *     --program D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3 \
 *     [--mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v] \
 *     [--fee-bps 50]
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function loadKeypair(path) {
  const secret = JSON.parse(readFileSync(path.replace(/^~/, homedir()), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function u64le(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(value));
  return b;
}

const url = arg("url", "https://api.mainnet-beta.solana.com");
const keypairPath = arg("keypair", "~/.config/solana/arcenpay-mainnet.json");
const programId = new PublicKey(arg("program", "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3"));
const treasury = new PublicKey(arg("treasury", ""));
const feeBps = Number(arg("fee-bps", "50"));

// Default mint: mainnet USDC when talking to mainnet, devnet USDC otherwise.
const isMainnet = url.includes("mainnet");
const mint = new PublicKey(
  arg("mint", isMainnet ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
);

const admin = loadKeypair(keypairPath);
const connection = new Connection(url, "confirmed");

const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
const [treasuryAta] = PublicKey.findProgramAddressSync(
  [treasury.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID,
);

console.log("=====================================================");
console.log("  ArcenPay — one-time program setup");
console.log("=====================================================");
console.log(`  rpc       : ${url}`);
console.log(`  program   : ${programId.toBase58()}`);
console.log(`  admin     : ${admin.publicKey.toBase58()}`);
console.log(`  treasury  : ${treasury.toBase58()}`);
console.log(`  mint      : ${mint.toBase58()}`);
console.log(`  fee       : ${feeBps} bps`);
console.log(`  config    : ${configPda.toBase58()}`);
console.log(`  treasury ATA: ${treasuryAta.toBase58()}`);
console.log();

const balance = await connection.getBalance(admin.publicKey);
console.log(`  admin balance: ${balance / 1e9} SOL`);
if (balance === 0) {
  console.error(`\n✗ ${admin.publicKey.toBase58()} has no SOL — it pays for the config account rent.`);
  process.exit(1);
}

// ── 1. initialize_config ────────────────────────────────────────────────────
const existingConfig = await connection.getAccountInfo(configPda);
if (existingConfig) {
  console.log("\n✓ Config already initialized — skipping (initialize_config runs once).");
} else {
  console.log("\n→ Calling initialize_config…");
  const discriminator = createHash("sha256")
    .update("global:initialize_config")
    .digest()
    .subarray(0, 8);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true }, // admin (payer)
      { pubkey: configPda, isSigner: false, isWritable: true },     // config PDA (init)
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([discriminator, treasury.toBuffer(), u64le(feeBps)]),
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);
    console.log(`  ✓ config initialized — tx ${sig}`);
  } catch (err) {
    console.error(`  ✗ initialize_config failed: ${err.message}`);
    process.exit(1);
  }
}

// ── 2. treasury's USDC token account ────────────────────────────────────────
const existingAta = await connection.getAccountInfo(treasuryAta);
if (existingAta) {
  console.log("\n✓ Treasury token account already exists — skipping.");
} else {
  console.log("\n→ Creating the treasury's USDC token account…");
  const ix = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: admin.publicKey, isSigner: true, isWritable: true }, // payer
      { pubkey: treasuryAta, isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([]),
  });

  try {
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);
    console.log(`  ✓ treasury token account created — tx ${sig}`);
  } catch (err) {
    console.error(`  ✗ creating the token account failed: ${err.message}`);
    process.exit(1);
  }
}

console.log(`
=====================================================
  ✅ PROGRAM READY
=====================================================
  program id : ${programId.toBase58()}
  treasury   : ${treasury.toBase58()}
  fee        : ${feeBps} bps

  Register the program id so the platform can reach it
  (all 7 roles = the same id):

    ARCENPAY_CONTRACT_9100000_subscriptionRegistry=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_autopayModule=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_planFactory=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_feeCollector=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_sessionVault=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_zkUsageVerifier=${programId.toBase58()}
    ARCENPAY_CONTRACT_9100000_mirrorRegistry=${programId.toBase58()}
=====================================================
`);
