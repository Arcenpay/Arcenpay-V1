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

const duplicates = await db.catalogPlan.findMany({
  where: {
    ...(teamId ? { teamId } : {}),
    metadata: { path: ["isPlatformTierPlan"], equals: true },
  },
  select: { id: true, teamId: true, environmentId: true, name: true, active: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});

const grouped = new Map<string, typeof duplicates>();
for (const plan of duplicates) {
  const key = `${plan.teamId}:${plan.environmentId ?? "null"}:${plan.name}`;
  const group = grouped.get(key) ?? [];
  group.push(plan);
  grouped.set(key, group);
}
const duplicatePlans = [...grouped.values()].flatMap((group) => group.slice(1));

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  accidentalSubscriptions: companies,
  duplicatePlans,
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
