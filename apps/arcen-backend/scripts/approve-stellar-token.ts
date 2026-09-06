#!/usr/bin/env node
/**
 * Admin script: approve a token on the Stellar PlanFactory contract.
 *
 * Usage:
 *   npx tsx scripts/approve-stellar-token.ts
 *
 * This uses the admin keypair to sign and submit an `approve_token`
 * invocation on the Soroban PlanFactory.
 */

import {
  Keypair,
  TransactionBuilder,
  Operation,
  Asset,
  rpc,
  Networks,
  contract,
  BASE_FEE,
} from "@stellar/stellar-sdk";

// ─── Configuration ───────────────────────────────────────────────────────────
//
// DEV-ONLY: the embedded admin secret is a PUBLIC Stellar TESTNET key used to
// drive the shared testnet PlanFactory deployment. It has no value on any
// other network — never point this script (or reuse its key) at mainnet.
// Prefer env vars (STELLAR_ADMIN_SECRET, PLAN_FACTORY_CONTRACT_ID) in real
const ADMIN_SECRET_KEY =
  process.env.STELLAR_ADMIN_SECRET || process.env.ADMIN_SECRET_KEY;
const PLAN_FACTORY_CONTRACT_ID =
  process.env.PLAN_FACTORY_CONTRACT_ID ||
  "CAF4VS5OMM6DW5ZN5JFJH4U2RJD6DODZYBHNXMTS6RSUMPDO3T4C73S7";
const TOKEN_ADDRESS =
  process.env.TOKEN_ADDRESS ||
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK_PASSPHRASE || Networks.TESTNET;

// ─── Execution ───────────────────────────────────────────────────────────────

async function main() {
  if (!ADMIN_SECRET_KEY) {
    console.error(
      "[approve-token] Error: Missing STELLAR_ADMIN_SECRET (or ADMIN_SECRET_KEY) environment variable.",
    );
    process.exit(1);
  }
  console.log("[approve-token] Starting token approval...\n");

  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET_KEY);
  const adminPublicKey = adminKeypair.publicKey();

  console.log("Admin:", adminPublicKey);
  console.log("PlanFactory:", PLAN_FACTORY_CONTRACT_ID);
  console.log("Token:", TOKEN_ADDRESS);
  console.log("RPC:", SOROBAN_RPC_URL);
  console.log("");

  // 1. Build a contract client
  const client = (await contract.Client.from({
    contractId: PLAN_FACTORY_CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    publicKey: adminPublicKey,
    signTransaction: async (xdr, opts) => {
      const network = opts?.networkPassphrase ?? NETWORK_PASSPHRASE;
      const tx = TransactionBuilder.fromXDR(xdr, network);
      tx.sign(adminKeypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: adminPublicKey };
    },
  })) as any;

  // 2. Invoke approve_token
  console.log("[approve-token] Building approve_token transaction...");
  const tx = await client.approve_token({
    admin: adminPublicKey,
    token: TOKEN_ADDRESS,
  });

  console.log("[approve-token] Simulating...");
  await tx.simulate();

  console.log("[approve-token] Signing and submitting...");
  const sent = await tx.signAndSend();

  console.log("\n✅ Success!");
  console.log("   Tx Hash:", sent.sendTransactionResponse?.hash ?? "unknown");

  // 3. Verify
  console.log("\n[approve-token] Verifying token is now approved...");
  const { result: isApproved } = await client.is_approved_token({
    token: TOKEN_ADDRESS,
  });

  if (isApproved) {
    console.log("✅ Token is approved. Plan registration should now work.\n");
  } else {
    console.error("❌ Token is still NOT approved. Something went wrong.\n");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
