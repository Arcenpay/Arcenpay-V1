/**
 * One-click platform billing setup for dogfooding.
 *
 * Creates everything needed for the ArcenPay platform to bill itself:
 *   - Bootstraps on-chain plans (unless --skip-onchain)
 *   - Creates FREE / PLUS / PRO catalog plans with entitlements & feature flags
 *   - Creates the platform subscription company
 *   - Creates the embed component (black & white design)
 *   - Sets up PlatformBillingCustomer + PlatformBillingAccount
 *   - Initialises subscription state
 *
 * Usage:
 *   npx tsx scripts/setup-platform-billing.ts --team-id <id>
 *   npx tsx scripts/setup-platform-billing.ts --team-id <id> --skip-onchain
 */

import { db } from "../src/db.js";
import { toPrismaJson } from "../src/utils/prisma-json.js";
import { bootstrapPlatformBillingPlans } from "../src/lib/billing/platform-tier-billing.js";
import { ensureTierCatalogPlan } from "../src/lib/billing/platform-tier-billing.js";
import { ensurePlatformSubscriptionCompany } from "../src/lib/billing/platform-tier-billing.js";
import { upsertSubscriptionLedgerState } from "../src/lib/billing/billing-ledger.js";
import { PLATFORM_BILLING_CHAIN_ID } from "../src/config.js";

// ── CLI ──────────────────────────────────────────────────────────────────────

function readArgs() {
  const args = process.argv.slice(2);
  const teamId = args.indexOf("--team-id") !== -1 ? args[args.indexOf("--team-id") + 1] : null;
  const skipOnChain = args.includes("--skip-onchain");
  return { teamId, skipOnChain };
}

function log(message: string) {
  console.log(`[setup-platform-billing] ${message}`);
}

async function main() {
  const { teamId, skipOnChain } = readArgs();

  if (!teamId) {
    console.error("Usage: npx tsx scripts/setup-platform-billing.ts --team-id <id> [--skip-onchain]");
    process.exit(1);
  }

  // 0. Validate team exists
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, slug: true, platformTier: true },
  });

  if (!team) {
    console.error(`Team not found: ${teamId}`);
    process.exit(1);
  }

  log(`Setting up platform billing for team "${team.name}" (${team.id})`);
  log(`Current platform tier: ${team.platformTier ?? "not set"}`);

  // Resolve environment
  const activeEnv = await db.workspaceEnvironment.findFirst({
    where: { teamId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  log(activeEnv ? `Using environment: ${activeEnv.id}` : "No environment — plans will be unscoped");

  // ── 1. Bootstrap on-chain plans ────────────────────────────────────────
  if (!skipOnChain) {
    log("Bootstrapping on-chain platform billing plans...");
    try {
      const result = await bootstrapPlatformBillingPlans();
      log(`On-chain bootstrap complete (chain ${result.chainId}):`);
      for (const plan of result.plans) {
        log(`  ${plan.tier}: onChainPlanId=${plan.onChainPlanId} status=${plan.syncStatus}`);
      }
    } catch (err) {
      log(`On-chain bootstrap failed: ${String(err)}`);
      log("Continuing with off-chain setup anyway (re-run without --skip-onchain once chain config is ready)");
    }
  } else {
    log("Skipping on-chain bootstrap (--skip-onchain)");
  }

  // ── 2. Ensure catalog plans exist ──────────────────────────────────────
  const tiers = ["FREE", "PLUS", "PRO"] as const;
  const planIds: Record<string, string> = {};

  for (const tier of tiers) {
    log(`Ensuring ${tier} catalog plan...`);
    const planId = await ensureTierCatalogPlan(teamId, tier);
    if (planId) {
      planIds[tier] = planId;
      log(`  ${tier} plan: ${planId}`);
    } else {
      log(`  ${tier} plan creation returned null`);
    }
  }

  // ── 3. Ensure subscription company ─────────────────────────────────────
  log("Creating platform subscription company...");
  const company = await ensurePlatformSubscriptionCompany(teamId);
  log(`  Company: ${company.id}`);

  // ── 4. Set up subscription state ───────────────────────────────────────
  const currentTier = (team.platformTier as string | null) ?? "FREE";
  const catalogPlanId = planIds[currentTier];

  if (catalogPlanId) {
    log(`Setting up subscription state for ${currentTier} tier...`);
    const existingSub = await db.subscriptionState.findFirst({
      where: { companyId: company.id },
      select: { id: true },
    });

    if (!existingSub) {
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      await upsertSubscriptionLedgerState({
        teamId,
        companyId: company.id,
        environmentId: activeEnv?.id ?? null,
        status: "ACTIVE",
        catalogPlanId,
        walletAddress: company.walletAddress ?? undefined as unknown as string,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        lastEvent: "platform.setup.script",
        lastEventAt: now,
        metadata: { source: "setup-platform-billing", tier: currentTier, isPlatformSubscription: true },
      });
      log("  Subscription state created");
    } else {
      log("  Subscription state already exists");
    }
  }

  // ── 5. Sync onChainPlanId from bootstrapped plans to CatalogPlan ───────
  for (const tier of ["PLUS", "PRO"] as const) {
    const onChainPlan = await db.platformBillingPlan.findFirst({
      where: { chainId: PLATFORM_BILLING_CHAIN_ID, tier, syncStatus: "SYNCED" },
      select: { onChainPlanId: true },
    });

    if (onChainPlan?.onChainPlanId && planIds[tier]) {
      await db.catalogPlan.updateMany({
        where: { id: planIds[tier] },
        data: {
          onChainPlanId: onChainPlan.onChainPlanId,
          chainId: PLATFORM_BILLING_CHAIN_ID,
          chainSyncStatus: "SYNCED",
        },
      });
      log(`  Synced onChainPlanId for ${tier}: ${onChainPlan.onChainPlanId}`);
    }
  }

  // ── 6. Create PlatformBillingCustomer ──────────────────────────────────
  log("Setting up PlatformBillingCustomer...");
  let customer = await db.platformBillingCustomer.findUnique({
    where: { workspaceTeamId: teamId },
  });

  if (!customer) {
    customer = await db.platformBillingCustomer.create({
      data: {
        workspaceTeamId: teamId,
        providerTeamId: teamId,
        environmentId: activeEnv?.id ?? null,
        companyId: company.id,
      },
    });
    log(`  Customer created: ${customer.id}`);
  } else {
    log(`  Customer already exists: ${customer.id}`);
  }

  // ── 7. Create embed component ──────────────────────────────────────────
  log("Setting up embed component...");
  let component = await db.embedComponent.findFirst({
    where: { teamId, name: "ArcenPay Platform Billing" },
  });

  const design = {
    primaryColor: "#000000",
    secondaryColor: "#f4f4f5",
    fontFamily: "Geist, Inter, system-ui, sans-serif",
    fontSize: 14,
    fontColor: "#0f172a",
    backgroundColor: "#ffffff",
    borderRadius: 8,
    cardStyle: "minimal",
    columns: 1,
    sections: "separate",
  };

  if (!component) {
    component = await db.embedComponent.create({
      data: {
        teamId,
        environmentId: activeEnv?.id ?? null,
        name: "ArcenPay Platform Billing",
        elements: toPrismaJson([
          { type: "planManager" },
          { type: "includedFeatures" },
          { type: "plansTable" },
          { type: "invoices" },
        ]),
        design: toPrismaJson(design),
      },
    });
    log(`  Component created: ${component.id}`);
  } else {
    component = await db.embedComponent.update({
      where: { id: component.id },
      data: { design: toPrismaJson(design) },
    });
    log(`  Component updated: ${component.id}`);
  }

  // ── 8. Create PlatformBillingAccount ───────────────────────────────────
  log("Setting up PlatformBillingAccount...");
  await db.platformBillingAccount.upsert({
    where: { providerTeamId: teamId },
    update: { portalComponentId: component.id },
    create: {
      providerTeamId: teamId,
      environmentId: activeEnv?.id ?? null,
      portalComponentId: component.id,
    },
  });
  log("  Account created/updated");

  // ── 9. Associate company with active plan ──────────────────────────────
  if (catalogPlanId && company.activePlanId !== catalogPlanId) {
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { activePlanId: catalogPlanId },
    });
    log(`  Company active plan set to: ${catalogPlanId}`);
  }

  log("");
  log("=============================================");
  log(" Platform billing setup complete.");
  log(` Team:           ${team.name} (${team.id})`);
  log(` Tier:           ${currentTier}`);
  log(` Company:        ${company.id}`);
  log(` Embed:          ${component.id}`);
  log(` Plans:          FREE=${planIds.FREE} PLUS=${planIds.PLUS} PRO=${planIds.PRO}`);
  log("");
  log(" Next steps:");
  log("   1. Open the dashboard → Billing & Plan");
  log("   2. Click 'Manage Subscription' to view your portal");
  log("   3. To upgrade, ensure env vars are set:");
  log("      PLATFORM_BILLING_OPS_PRIVATE_KEY");
  log("      PLATFORM_BILLING_TREASURY_ADDRESS");
  log("      PIMLICO_API_KEY");
  log("=============================================");

  await db.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
