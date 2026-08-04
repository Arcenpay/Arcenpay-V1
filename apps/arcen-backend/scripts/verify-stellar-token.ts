#!/usr/bin/env node
/**
 * Verify token approval by simulating a dummy create_plan.
 * If it doesn't throw TokenNotApproved, the token is whitelisted.
 */

import {
  Keypair,
  TransactionBuilder,
  Operation,
  rpc,
  Networks,
  contract,
  xdr,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const ADMIN_SECRET_KEY = "SDF4YHZLS7UP5R456NVWCCMTNPQEDCF67QYXADFE2RJM66I2NKKY7B6I";
const PLAN_FACTORY_CONTRACT_ID = "CAF4VS5OMM6DW5ZN5JFJH4U2RJD6DODZYBHNXMTS6RSUMPDO3T4C73S7";
const TOKEN_ADDRESS = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = Networks.TESTNET;

async function main() {
  const adminKeypair = Keypair.fromSecret(ADMIN_SECRET_KEY);
  const adminPublicKey = adminKeypair.publicKey();

  const server = new rpc.Server(SOROBAN_RPC_URL, {
    allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
  });

  // Build a probe transaction: simulate create_plan with the token
  console.log("[verify] Simulating probe create_plan to verify token approval...\n");

  // Fetch the latest ledger to set the sequence
  const accountRes = await server.getLatestLedger();
  const sequence = BigInt(accountRes.sequence);

  // Build a raw invokeHostFunction transaction
  const scValAdmin = xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
    xdr.AccountID.fromPublicKey(adminPublicKey)
  ));

  const scValToken = xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
    xdr.AccountID.fromPublicKey(TOKEN_ADDRESS)
  ));

  // Encode the function call: create_plan(provider, name, tier, price, billing_interval, accepted_token, metadata_uri)
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: xdr.ScAddress.scAddressTypeContract(
        xdr.Hash.fromXDR(PLAN_FACTORY_CONTRACT_ID, "strkey")
      ),
      functionName: Buffer.from("create_plan"),
      args: [
        scValAdmin,
        xdr.ScVal.scvString("__probe__"),
        xdr.ScVal.scvString("__probe__"),
        xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: xdr.Int64.fromString("0"), lo: xdr.Uint64.fromString("1") })),
        xdr.ScVal.scvU64(xdr.Uint64.fromString("2592000")),
        scValToken,
        xdr.ScVal.scvString(""),
      ],
    })
  );

  const source = new rpc.Account(adminPublicKey, sequence.toString());
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth: [] }))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);

  if (sim.status === "SUCCESS") {
    console.log("✅ Token is APPROVED. Simulation succeeded (no TokenNotApproved error).\n");
    console.log("Go to the dashboard and register your plan now.");
    return;
  }

  // Check for specific error
  const diagEvents = (sim as any).diagnosticEvents ?? [];
  for (const ev of diagEvents) {
    const topics = ev.event()?.body()?.v0()?.topics?.map((t: xdr.ScVal) => {
      try { return t.sym()?.toString(); } catch { return null; }
    }) ?? [];
    if (topics.includes("error")) {
      console.log("❌ Token is NOT approved. Simulation failed with error event.\n");
      console.log("Diagnostic events:", JSON.stringify(diagEvents, null, 2));
      process.exit(1);
    }
  }

  console.log("⚠️ Simulation status:", sim.status);
  console.log("Raw result:", JSON.stringify(sim, null, 2));
}

main().catch((err) => {
  console.error("\n❌ Verification failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
