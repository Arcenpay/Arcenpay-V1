/**
 * Syncs plan entitlements to FlagRule + FlagRuleCondition rows.
 *
 * Called after any entitlement save (POST/PUT/DELETE).
 * Deletes existing plan-generated rules for this plan, then recreates them.
 */

import { db } from "@/lib/db";

export interface PlanEntitlement {
  featureName: string;
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  valueUnit?: string | null;
  enabled: boolean;
}

function toFeatureType(type: PlanEntitlement["type"]): string {
  switch (type) {
    case "NUMERIC":
    case "UNLIMITED":
      return "event_based";
    case "BOOLEAN":
    default:
      return "boolean";
  }
}

export async function syncEntitlementsToFlagRules(
  teamId: string,
  planId: string,
  entitlements: PlanEntitlement[],
): Promise<void> {
  // Step 1: Delete all existing plan-generated rules for this plan.
  // FlagRuleConditions are deleted via cascade.
  await db.flagRule.deleteMany({
    where: {
      source: "plan",
      sourceId: planId,
      flag: { teamId },
    },
  });

  // Step 2: Recreate rules for each enabled entitlement.
  for (const entitlement of entitlements) {
    if (!entitlement.enabled) continue;

    const flag = await db.catalogFeatureFlag.upsert({
      where: {
        teamId_featureKey: { teamId, featureKey: entitlement.featureKey },
      },
      update: {
        name: entitlement.featureName,
        featureType: toFeatureType(entitlement.type),
        eventKey: entitlement.type !== "BOOLEAN" ? entitlement.featureKey : undefined,
      },
      create: {
        teamId,
        featureKey: entitlement.featureKey,
        name: entitlement.featureName,
        featureType: toFeatureType(entitlement.type),
        defaultValue: false,
        eventKey: entitlement.type !== "BOOLEAN" ? entitlement.featureKey : undefined,
      },
    });

    const rule = await db.flagRule.create({
      data: {
        flagId: flag.id,
        priority: 100,
        value: true,
        source: "plan",
        sourceId: planId,
      },
    });

    await db.flagRuleCondition.create({
      data: {
        ruleId: rule.id,
        criteriaType: "base_plan",
        operator: "is_one_of",
        values: [planId],
      },
    });

    if (entitlement.type === "NUMERIC" && typeof entitlement.value === "number") {
      await db.flagRuleCondition.create({
        data: {
          ruleId: rule.id,
          criteriaType: "usage",
          operator: "is_less_than",
          values: [],
          metricKey: entitlement.featureKey,
          metricValue: Number(entitlement.value),
          metricPeriod: "monthly",
        },
      });
    }
  }
}
