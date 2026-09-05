/**
 * Stellar recurring-billing E2E verification (deterministic, DB-level).
 *
 * Proves the backend half of "money auto-deducts after a duration":
 *   1. Seeds a Stellar-testnet (chainId 9000001) company + ACTIVE
 *      SubscriptionState whose period has elapsed.
 *   2. Drives the EXACT renewal event the facilitator's StellarChainAdapter
 *      posts after an on-chain `autopay-account.execute` charge
 *      (`ingestBillingEvent` with SUBSCRIPTION_RENEWED + new expiration).
 *   3. Asserts the SubscriptionState advanced to the new period end and the
 *      renewal BillingEvent was recorded.
 *   4. Replays the same idempotencyKey and asserts it is deduped (no-op).
 *
 * The on-chain charge itself is proven by the Rust time-jump contract tests in
 * packages/stellar-contracts (autopay-account + subscription-registry), since
 * Soroban's MIN_BILLING_INTERVAL (30 days) makes a wall-clock run impractical.
 *
 * Usage (from apps/arcen-backend):
 *   npx tsx scripts/verify-stellar-renewal.ts
 * Requires the local Postgres (docker compose up -d) + DATABASE_URL.
 */

import { db } from "../src/db.js";
import { ingestBillingEvent } from "../src/lib/billing/billing-events.js";
import { STELLAR_TESTNET_CHAIN_ID } from "@arcenpay/internal-core";

const STELLAR_WALLET =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const BILLING_INTERVAL_SECONDS = 2_592_000; // 30 days (matches MIN_BILLING_INTERVAL)

function log(message: string) {
  console.log(`[verify-stellar-renewal] ${message}`);
}

function assert(cond: boolean, message: string): void {
  if (!cond) {
    console.error(`  ✗ FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`  ✓ ${message}`);
}

async function main() {
  log("Starting Stellar renewal E2E verification…");
  const now = Date.now();

  // 1. Fixture — team, company, plan (minimal), ACTIVE subscription state.
  const team = await db.team.create({
    data: {
      name: `Stellar Renewal E2E ${now}`,
      slug: `stellar-renewal-e2e-${now}`,
    },
  });

  // A published catalog plan so the ledger stores a valid catalogPlanId.
  const plan = await db.catalogPlan.create({
    data: {
      teamId: team.id,
      name: `Stellar Pro ${now}`,
      tier: "pro",
      status: "PUBLISHED",
      active: true,
      price: "9.99",
      billingInterval: BILLING_INTERVAL_SECONDS,
      chainId: STELLAR_TESTNET_CHAIN_ID,
      chainFamily: "STELLAR",
      onChainPlanId: "9999000001",
      acceptedToken: STELLAR_WALLET,
      environmentMode: "DEVELOPMENT",
    },
  });

  const company = await db.arcenCompany.create({
    data: {
      teamId: team.id,
      name: "Stellar Renewal E2E Customer",
      email: `stellar-${now}@example.com`,
      walletAddress: STELLAR_WALLET,
      activePlanId: plan.id,
    },
  });

  // Period already elapsed: currentPeriodEnd is 1s in the past.
  const firstPeriodEnd = new Date(now - 1_000);
  const state = await db.subscriptionState.create({
    data: {
      teamId: team.id,
      companyId: company.id,
      environmentId: null,
      walletAddress: STELLAR_WALLET,
      status: "ACTIVE",
      catalogPlanId: plan.id,
      chainId: STELLAR_TESTNET_CHAIN_ID,
      chainFamily: "STELLAR",
      onChainPlanId: plan.onChainPlanId!,
      onChainTokenId: "token-stellar-1",
      currentPeriodStart: new Date(now - BILLING_INTERVAL_SECONDS * 1000),
      currentPeriodEnd: firstPeriodEnd,
    },
  });
  log(
    `Seeded company=${company.id} state=${state.id} periodEnd=${firstPeriodEnd.toISOString()}`,
  );

  // 2. Drive the renewal event exactly as the facilitator would after an
  //    on-chain autopay `execute` (BillingExecuted reason=1 → SUBSCRIPTION_RENEWED).
  const renewalTxHash = `renewal-${now}-${Math.random().toString(16).slice(2)}`;
  const newExpirationSecs = Math.floor(now / 1000) + BILLING_INTERVAL_SECONDS;
  const idempotencyKey = `e2e:stellar:renewed:${renewalTxHash}`;

  log("Driving SUBSCRIPTION_RENEWED via ingestBillingEvent…");
  const result = await ingestBillingEvent({
    teamId: team.id,
    eventType: "SUBSCRIPTION_RENEWED",
    eventName: "subscription.renewed",
    idempotencyKey,
    occurredAt: new Date(now),
    triggerInvoice: false, // DB-half proof; invoice path needs a full plan+credit setup
    payload: {
      tokenId: "token-stellar-1",
      onChainPlanId: plan.onChainPlanId,
      customerWallet: STELLAR_WALLET,
      subscriber: STELLAR_WALLET,
      amount: 9.99,
      expiration: String(newExpirationSecs),
      txHash: renewalTxHash,
      chainId: STELLAR_TESTNET_CHAIN_ID,
      description: "Subscription renewal",
    },
  });

  assert(result.deduped === false, "first ingest is not a duplicate");
  log(`Ingest result: processedNow=${result.processedNow} skipped=${result.skipped}`);

  // 3. Assert the subscription advanced to the new period end.
  const updated = await db.subscriptionState.findUnique({
    where: { id: state.id },
    select: {
      status: true,
      currentPeriodEnd: true,
      lastEvent: true,
      chainId: true,
      chainFamily: true,
    },
  });
  assert(updated !== null, "subscription state still exists");
  assert(updated!.status === "ACTIVE", "status stays ACTIVE after renewal");
  assert(updated!.chainId === STELLAR_TESTNET_CHAIN_ID, "chainId is Stellar testnet");
  assert(updated!.chainFamily === "STELLAR", "chainFamily is STELLAR");
  const advancedEnd = updated!.currentPeriodEnd?.getTime() ?? 0;
  assert(
    advancedEnd >= newExpirationSecs * 1000 - 60_000 &&
      advancedEnd <= newExpirationSecs * 1000 + 60_000,
    `currentPeriodEnd advanced to ~${new Date(newExpirationSecs * 1000).toISOString()} ` +
      `(got ${updated!.currentPeriodEnd?.toISOString()})`,
  );
  assert(
    updated!.lastEvent === "subscription.renewed",
    `lastEvent recorded as subscription.renewed (got ${updated!.lastEvent})`,
  );

  // 4. Replay the identical event → must dedupe.
  log("Replaying identical renewal event…");
  const replay = await ingestBillingEvent({
    teamId: team.id,
    eventType: "SUBSCRIPTION_RENEWED",
    eventName: "subscription.renewed",
    idempotencyKey,
    occurredAt: new Date(now),
    triggerInvoice: false,
    payload: {
      tokenId: "token-stellar-1",
      onChainPlanId: plan.onChainPlanId,
      customerWallet: STELLAR_WALLET,
      subscriber: STELLAR_WALLET,
      amount: 9.99,
      expiration: String(newExpirationSecs),
      txHash: renewalTxHash,
      chainId: STELLAR_TESTNET_CHAIN_ID,
    },
  });
  assert(replay.deduped === true, "replayed renewal is deduped (no double-charge)");

  const storedEvent = await db.billingEvent.findUnique({
    where: { idempotencyKey },
    select: { processed: true, eventType: true },
  });
  assert(
    storedEvent?.processed === true && storedEvent.eventType === "SUBSCRIPTION_RENEWED",
    "renewal BillingEvent stored and processed",
  );

  log("✅ Stellar recurring-billing E2E passed: renewal advanced the period and is idempotent.");
  log(
    `Evidence: team=${team.id} company=${company.id} state=${state.id} ` +
      `event=${idempotencyKey} newPeriodEnd=${new Date(newExpirationSecs * 1000).toISOString()}`,
  );

  // Clean up the seeded fixture so the script is repeatable.
  await db.billingEvent.deleteMany({ where: { teamId: team.id } });
  await db.subscriptionState.deleteMany({ where: { id: state.id } });
  await db.arcenCompany.delete({ where: { id: company.id } });
  await db.catalogPlan.delete({ where: { id: plan.id } });
  await db.team.delete({ where: { id: team.id } });
  log("Fixture cleaned up.");
}

main()
  .catch((err) => {
    console.error("Stellar renewal E2E failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
