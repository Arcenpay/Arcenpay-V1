/**
 * Audits and repairs records created by the old platform-billing embed initializer.
 * Dry-run is the default. Use --apply only after reviewing the report.
 */
import { randomUUID } from "node:crypto";
import { db } from "../src/db.js";
import { toPrismaJson } from "../src/utils/prisma-json.js";

const apply = process.argv.includes("--apply");
const teamArgIndex = process.argv.indexOf("--team-id");
const teamId = teamArgIndex >= 0 ? process.argv[teamArgIndex + 1] : undefined;
const platformPlanNames = [
  "ArcenPay Free Plan",
  "ArcenPay Pro Plan",
  "ArcenPay Enterprise Plan",
];

const companies = await db.arcenCompany.findMany({
  where: {
    ...(teamId ? { teamId } : {}),
    subscriptionState: {
      metadata: { path: ["source"], equals: "platform-billing-embed-init" },
    },
  },
  select: {
    id: true,
    teamId: true,
    activePlanId: true,
    subscriptionState: { select: { id: true, status: true, metadata: true } },
  },
});

const platformAccounts = await db.platformBillingAccount.findMany({
  select: { providerTeamId: true, environmentId: true },
});

const platformPlans = await db.catalogPlan.findMany({
  where: {
    ...(teamId ? { teamId } : { teamId: { in: platformAccounts.map((a) => a.providerTeamId) } }),
    ...(platformAccounts.length > 0
      ? { environmentId: { in: platformAccounts.map((a) => a.environmentId) } }
      : {}),
    name: { in: platformPlanNames },
  },
  select: { id: true, teamId: true, environmentId: true, name: true, active: true, createdAt: true, metadata: true },
  orderBy: { createdAt: "asc" },
});

const grouped = new Map<string, typeof platformPlans>();
for (const plan of platformPlans) {
  const key = `${plan.teamId}:${plan.environmentId ?? "null"}:${plan.name}`;
  const group = grouped.get(key) ?? [];
  group.push(plan);
  grouped.set(key, group);
}
const keepers = new Map<string, (typeof platformPlans)[number]>();
const duplicatePlans = [...grouped.values()].flatMap((group) => {
  const keeper = group.find((plan) => {
    const metadata = plan.metadata;
    return plan.active && typeof metadata === "object" && metadata !== null &&
      !Array.isArray(metadata) && (metadata as Record<string, unknown>).isFirstPartyPlan === true;
  }) ?? group.find((plan) => plan.active) ?? group[0];
  if (keeper) keepers.set(`${keeper.teamId}:${keeper.environmentId}:${keeper.name}`, keeper);
  return group.filter((plan) => plan.id !== keeper?.id && plan.active);
});

const livePlanRepairs = [...keepers.values()].reduce<Record<string, string[]>>((result, plan) => {
  const key = `${plan.teamId}:${plan.environmentId}`;
  (result[key] ??= []).push(plan.id);
  return result;
}, {});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  accidentalSubscriptions: companies,
  duplicatePlans,
  livePlanRepairs,
  counts: { accidentalSubscriptions: companies.length, duplicatePlans: duplicatePlans.length },
}, null, 2));

if (apply) {
  const now = new Date();
  for (const company of companies) {
    await db.subscriptionState.update({
      where: { id: company.subscriptionState.id },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelAtPeriodEnd: false,
        lastEvent: "platform.billing.repair",
        lastEventAt: now,
        metadata: {
          ...(company.subscriptionState.metadata as Record<string, unknown>),
          repaired: true,
          repairedAt: now.toISOString(),
        },
      },
    });
    await db.arcenCompany.update({
      where: { id: company.id },
      data: { activePlanId: null },
    });
  }
  for (const plan of duplicatePlans) {
    await db.catalogPlan.update({ where: { id: plan.id }, data: { active: false, status: "ARCHIVED" } });
  }
  for (const [key, livePlanIds] of Object.entries(livePlanRepairs)) {
    const [providerTeamId, environmentId] = key.split(":");
    await db.catalogConfig.updateMany({
      where: { teamId: providerTeamId, environmentId },
      data: { livePlanIds, restrictLivePlans: true },
    });
  }
  await db.auditEvent.createMany({
    data: companies.map((company) => ({
      teamId: company.teamId,
      actorType: "SYSTEM" as const,
      action: "platform.billing.repair",
      resourceType: "SubscriptionState",
      resourceId: company.subscriptionState.id,
      requestId: randomUUID(),
      beforeData: toPrismaJson(company.subscriptionState.metadata),
      afterData: toPrismaJson({ repaired: true, cancelled: true }),
    })),
  });
  console.log(`Applied repair: ${companies.length} subscriptions and ${duplicatePlans.length} plans.`);
}

await db.$disconnect();
