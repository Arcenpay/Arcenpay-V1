/**
 * Rebuild the canonical ArcenPay platform catalog.
 *
 * Default: dry run. Use --apply to archive old catalog plans and create only
 * Free, Pro, and Enterprise as drafts. Financial history is never deleted.
 */
import { db } from "../src/db.js";
import { toPrismaJson } from "../src/utils/prisma-json.js";
import { ensureTierCatalogPlan } from "../src/lib/billing/platform-tier-billing.js";
import { syncEntitlementsToFlagRules } from "../src/lib/entitlements/sync-entitlements.js";
import { buildPlatformTierEntitlements } from "../src/lib/billing/platform-tier-billing.js";

const PLATFORM_OWNER_WALLET = "0x38f62ccfd6f771ef9e48e3bb86a3e0413ae5319b";
const PLATFORM_COMPONENT_NAME = "ArcenPay Platform Billing";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");

function log(message: string) {
  console.log(`[reset-platform-catalog] ${message}`);
}

async function main() {
  let owner = await db.teamMember.findFirst({
    where: {
      role: "OWNER",
      user: { walletAddress: PLATFORM_OWNER_WALLET },
    },
    select: { teamId: true, team: { select: { id: true, name: true } } },
  });
  if (!owner && apply) {
    const createdUser = await db.user.create({
      data: {
        email: process.env.PLATFORM_OWNER_EMAIL || "admin@arcenpay.com",
        emailVerified: true,
        walletAddress: PLATFORM_OWNER_WALLET,
        teams: {
          create: {
            role: "OWNER",
            team: {
              create: {
                name: "ArcenPay Platform",
                slug: "arcenpay-platform",
                environments: {
                  create: {
                    name: "Arc Testnet",
                    mode: "DEVELOPMENT",
                    chainId: Number(process.env.PLATFORM_BILLING_CHAIN_ID ?? "5042002"),
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true, teams: { select: { teamId: true } } },
    });
    const teamId = createdUser.teams[0]?.teamId;
    if (teamId) {
      await db.user.update({ where: { id: createdUser.id }, data: { currentTeamId: teamId } });
    }
    owner = await db.teamMember.findFirst({
      where: { role: "OWNER", user: { walletAddress: PLATFORM_OWNER_WALLET } },
      select: { teamId: true, team: { select: { id: true, name: true } } },
    });
  }
  if (!owner) {
    log("No canonical owner workspace exists yet. Dry run did not create one.");
    return;
  }

  const environments = await db.workspaceEnvironment.findMany({
    where: { teamId: owner.teamId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, mode: true },
  });
  if (environments.length === 0) throw new Error("Canonical platform owner has no environment.");

  const existingPlans = await db.catalogPlan.findMany({
    where: { teamId: owner.teamId },
    select: { id: true, name: true, status: true, active: true, environmentId: true },
  });

  log(`Canonical provider: ${owner.team.name} (${owner.teamId})`);
  log(`Catalog environments: ${environments.map((item) => `${item.name} (${item.id})`).join(", ")}`);
  log(`Plans to archive: ${existingPlans.length}`);
  log("New plans: ArcenPay Free Plan, ArcenPay Pro Plan, ArcenPay Enterprise Plan");
  log("New plans will be DRAFT with no on-chain identity.");

  if (!apply) {
    log("Dry run only. Re-run with --apply to make these changes.");
    return;
  }

  const oldPlanIds = existingPlans.map((plan) => plan.id);
  const oldFreePlanIds = new Set(
    (await db.catalogPlan.findMany({
      where: { id: { in: oldPlanIds }, price: 0 },
      select: { id: true },
    })).map((plan) => plan.id),
  );
  if (oldPlanIds.length > 0) {
    await db.flagRule.deleteMany({
      where: { source: "plan", sourceId: { in: oldPlanIds }, flag: { teamId: owner.teamId } },
    });
    await db.catalogPlan.updateMany({
      where: { id: { in: oldPlanIds } },
      data: { active: false, status: "ARCHIVED" },
    });
  }

  const plansByEnvironment = new Map<string, Record<"FREE" | "PLUS" | "PRO", string>>();
  for (const environment of environments) {
    const planIds: Record<"FREE" | "PLUS" | "PRO", string> = {
      FREE: await ensureTierCatalogPlan(owner.teamId, "FREE", { environmentId: environment.id, publish: false, syncOnchain: false }) as string,
      PLUS: await ensureTierCatalogPlan(owner.teamId, "PLUS", { environmentId: environment.id, publish: false, syncOnchain: false }) as string,
      PRO: await ensureTierCatalogPlan(owner.teamId, "PRO", { environmentId: environment.id, publish: false, syncOnchain: false }) as string,
    };
    plansByEnvironment.set(environment.id, planIds);

    await db.catalogConfig.upsert({
      where: { environmentId: environment.id },
      update: {
        livePlanIds: [planIds.FREE, planIds.PLUS, planIds.PRO],
        restrictLivePlans: true,
        initialPlan: planIds.FREE,
        fallbackPlan: planIds.FREE,
      },
      create: {
        teamId: owner.teamId,
        environmentId: environment.id,
        environmentMode: environment.mode,
        livePlanIds: [planIds.FREE, planIds.PLUS, planIds.PRO],
        restrictLivePlans: true,
        initialPlan: planIds.FREE,
        fallbackPlan: planIds.FREE,
      },
    });

    for (const tier of ["FREE", "PLUS", "PRO"] as const) {
      await syncEntitlementsToFlagRules(owner.teamId, planIds[tier], buildPlatformTierEntitlements(tier));
    }
  }

  const planIds = plansByEnvironment.get(environments[0].id)!;

  // Move only existing first-party FREE subscriptions to the new canonical
  // FREE plan. Paid subscriptions and immutable financial history are kept.
  const firstPartyCustomers = await db.platformBillingCustomer.findMany({
    where: { providerTeamId: owner.teamId },
    select: {
      companyId: true,
      company: {
        select: {
          activePlanId: true,
          subscriptionState: {
            select: { id: true, catalogPlanId: true, status: true },
          },
        },
      },
    },
  });
  for (const customer of firstPartyCustomers) {
    const subscription = customer.company.subscriptionState;
    if (
      !subscription ||
      subscription.status !== "ACTIVE" ||
      !subscription.catalogPlanId ||
      !oldFreePlanIds.has(subscription.catalogPlanId)
    ) continue;
    await db.subscriptionState.update({
      where: { id: subscription.id },
      data: { catalogPlanId: planIds.FREE },
    });
    await db.arcenCompany.update({
      where: { id: customer.companyId },
      data: { activePlanId: planIds.FREE },
    });
  }

  const component = await db.embedComponent.findFirst({
    where: { teamId: owner.teamId, name: PLATFORM_COMPONENT_NAME },
    select: { id: true },
  });
  const componentId = component?.id ?? (await db.embedComponent.create({
    data: {
      teamId: owner.teamId,
      environmentId: environments[0].id,
      name: PLATFORM_COMPONENT_NAME,
      elements: toPrismaJson([
        { type: "planManager" },
        { type: "includedFeatures" },
        { type: "plansTable" },
        { type: "invoices" },
      ]),
      design: toPrismaJson({
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
      }),
    },
    select: { id: true },
  })).id;

  await db.platformBillingAccount.upsert({
    where: {
      providerTeamId_environmentId: {
        providerTeamId: owner.teamId,
        environmentId: environments[0].id,
      },
    },
    update: { portalComponentId: componentId },
    create: {
      providerTeamId: owner.teamId,
      environmentId: environments[0].id,
      portalComponentId: componentId,
    },
  });

  log(`Created draft plans: ${JSON.stringify(planIds)}`);
  log("Catalog reset complete. Manually sync and publish the plans when ready.");
}

main().catch((error) => {
  console.error("[reset-platform-catalog] Fatal:", error);
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
