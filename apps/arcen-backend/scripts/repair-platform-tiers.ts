import { db } from "../src/db.js";
import { projectPlatformBillingEntitlement } from "../src/lib/billing/platform-billing-customer.js";

/**
 * One-off repair script: re-project platform tiers for all active platform
 * subscriptions that are stuck on FREE. Run with:
 *   npx tsx scripts/repair-platform-tiers.ts
 *
 * Safe to re-run: projectPlatformBillingEntitlement is idempotent and skips
 * workspaces that are already on the correct tier.
 */
async function repair() {
  // Find all platform billing customers with an ACTIVE subscription
  // but whose workspace team is still on FREE.
  const stuck = await db.platformBillingCustomer.findMany({
    where: {
      workspaceTeam: { platformTier: "FREE" },
      company: {
        subscriptionState: { status: "ACTIVE" },
      },
    },
    select: {
      companyId: true,
      providerTeamId: true,
      workspaceTeamId: true,
    },
  });

  console.log(`Found ${stuck.length} stuck workspace(s)`);

  for (const row of stuck) {
    try {
      const result = await projectPlatformBillingEntitlement({
        providerTeamId: row.providerTeamId,
        companyId: row.companyId,
      });
      console.log(
        `  ${row.workspaceTeamId} → projected=${result.projected} tier=${result.tier}`,
      );
    } catch (err) {
      console.error(`  ${row.workspaceTeamId} → ERROR:`, err);
    }
  }

  await db.$disconnect();
}

repair().catch((e) => {
  console.error(e);
  process.exit(1);
});
