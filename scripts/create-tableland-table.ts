#!/usr/bin/env tsx
// ============================================================
//  ArcenPay — Tableland Table Setup Script
//
//  Creates the entitlements table on Tableland (Base Sepolia).
//  Run once per environment; table is permanent on-chain.
//
//  Usage:
//    TABLELAND_PRIVATE_KEY=0x... npm run tableland:create
//
//  After it completes, copy the printed TABLELAND_TABLE_NAME
//  into apps/arcen-dashboard/.env.local (and facilitator/.env).
// ============================================================

import { Database } from '@tableland/sdk';
import { JsonRpcProvider, Wallet } from 'ethers';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Load env vars (try apps/arcen-dashboard/.env.local first, then root .env)
// ---------------------------------------------------------------------------
function loadEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), 'apps/arcen-dashboard/.env.local'),
    path.resolve(process.cwd(), 'apps/arcen-dashboard/.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
          process.env[key] = value;
        }
      }
      console.log(`[setup] Loaded env from ${filePath}`);
      break;
    }
  }
}

loadEnv();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PRIVATE_KEY = process.env.TABLELAND_PRIVATE_KEY;
const CHAIN_ID = 11155111; // Ethereum Sepolia (free faucet gas, no Base gas needed)
const RPC_URL =
  process.env.SEPOLIA_RPC_URL ??
  'https://ethereum-sepolia-rpc.publicnode.com';
const GATEWAY_URL =
  process.env.TABLELAND_GATEWAY_URL ??
  'https://testnets.tableland.network';

// Table schema — mirrors TablelandEntitlement in packages/sdk-core/src/types.ts
const TABLE_PREFIX = 'arcenpay_entitlements';
const CREATE_SCHEMA = `
  wallet_address text,
  nft_token_id   integer,
  plan_tier      text,
  feature_flags  text,
  api_rate_limit integer,
  billing_interval integer,
  last_renewed   integer,
  expires_at     integer,
  chain_id       integer
`.trim();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (!PRIVATE_KEY) {
    console.error('\n[error] TABLELAND_PRIVATE_KEY is not set.');
    console.error(
      '  Add it to apps/arcen-dashboard/.env.local or pass it inline:\n' +
        '  TABLELAND_PRIVATE_KEY=0x... npm run tableland:create\n',
    );
    process.exit(1);
  }

  console.log('\n[setup] Connecting to Tableland on Ethereum Sepolia (chainId 11155111)...');
  console.log(`[setup] RPC  : ${RPC_URL}`);
  console.log(`[setup] GW   : ${GATEWAY_URL}\n`);

  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);

  const address = await signer.getAddress();
  console.log(`[setup] Wallet: ${address}`);

  // Check ETH balance — table creation costs a small amount of gas
  const balance = await provider.getBalance(address);
  const balanceEth = Number(balance) / 1e18;
  if (balanceEth < 0.001) {
    console.warn(
      `\n[warn] Wallet balance is ${balanceEth.toFixed(6)} ETH on Ethereum Sepolia.` +
        '\n       You need a small amount of ETH to pay for table creation gas.' +
        '\n       Get free testnet ETH from any of:' +
        '\n         • https://faucet.triangleplatform.com/ethereum/sepolia' +
        '\n         • https://sepoliafaucet.com' +
        '\n         • https://faucets.chain.link/sepolia\n',
    );
  } else {
    console.log(`[setup] Balance: ${balanceEth.toFixed(6)} ETH ✓\n`);
  }

  // IMPORTANT: Do NOT pass baseUrl here.
  // baseUrl routes traffic to the HTTP gateway — which returns "Method Not Allowed" for writes.
  // CREATE TABLE is an on-chain transaction; the SDK submits it directly to the
  // Tableland Registry contract via the signer/provider, no gateway needed.
  const db = new Database({ signer });

  console.log('[setup] Creating table...');
  console.log(`[setup] Schema:\n  ${CREATE_SCHEMA.replace(/\n/g, '\n  ')}\n`);
  console.log('[setup] Submitting on-chain transaction (this takes ~15-30s)...\n');

  const { meta } = await db
    .prepare(`CREATE TABLE ${TABLE_PREFIX} (${CREATE_SCHEMA})`)
    .run();

  console.log('[setup] Transaction submitted, waiting for confirmation...');
  await meta.txn?.wait();

  const tableName = meta.txn?.name;
  if (!tableName) {
    throw new Error('Table creation succeeded but table name was not returned by Tableland SDK');
  }

  console.log('✅ Table created successfully!\n');
  console.log('━'.repeat(60));
  console.log(`  TABLE NAME: ${tableName}`);
  console.log('━'.repeat(60));
  console.log('\nNext steps:');
  console.log('  1. Copy the table name above');
  console.log('  2. Add to apps/arcen-dashboard/.env.local:');
  console.log(`       TABLELAND_TABLE_NAME=${tableName}`);
  console.log(`       TABLELAND_PRIVATE_KEY=${PRIVATE_KEY.slice(0, 6)}...`);
  console.log('  3. Add to apps/facilitator/.env:');
  console.log(`       TABLELAND_TABLE_NAME=${tableName}`);
  console.log(`       TABLELAND_PRIVATE_KEY=<same key>`);
  console.log('  4. Restart both services\n');
}

main().catch((err) => {
  console.error('\n[error]', err.message ?? err);
  process.exit(1);
});
