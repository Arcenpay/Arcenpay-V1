import { db } from "@/lib/db";

export interface MetadataEntitlementLink {
  featureKey: string;
  enabled?: boolean;
  type?: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value?: boolean | number | null;
}

export interface LinkedPlanSummary {
  id: string;
  name: string;
  tier: string;
}

export interface LinkedPlanEntitlementSummary extends LinkedPlanSummary {
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  valueUnit?: string | null;
}

export function listMetadataEntitlements(metadata: unknown): MetadataEntitlementLink[] {
  if (!metadata || typeof metadata !== "object") return [];

  const entitlements = (metadata as { entitlements?: unknown[] }).entitlements;
  if (!Array.isArray(entitlements)) return [];

  return entitlements.filter((entry): entry is MetadataEntitlementLink => {
    if (!entry || typeof entry !== "object") return false;

    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.featureKey === "string" &&
      (candidate.enabled === undefined || typeof candidate.enabled === "boolean")
    );
  });
}

export async function loadPublishedPlanLinksByFeatureKey(teamId: string) {
  const plans = await db.catalogPlan.findMany({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      name: true,
      tier: true,
      metadata: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const linkedPlansByFeatureKey = new Map<string, Map<string, LinkedPlanSummary>>();

  for (const plan of plans) {
    for (const entitlement of listMetadataEntitlements(plan.metadata)) {
      if (entitlement.enabled === false) continue;

      const plansForFeature = linkedPlansByFeatureKey.get(entitlement.featureKey) ?? new Map<string, LinkedPlanSummary>();
      plansForFeature.set(plan.id, {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
      });
      linkedPlansByFeatureKey.set(entitlement.featureKey, plansForFeature);
    }
  }

  return new Map(
    Array.from(linkedPlansByFeatureKey.entries()).map(([featureKey, linkedPlans]) => [
      featureKey,
      Array.from(linkedPlans.values()).sort((left, right) => left.name.localeCompare(right.name)),
    ]),
  );
}

export async function loadPublishedPlanEntitlementsByFeatureKey(teamId: string) {
  const plans = await db.catalogPlan.findMany({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      name: true,
      tier: true,
      metadata: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const entitlementsByFeatureKey = new Map<string, Map<string, LinkedPlanEntitlementSummary>>();

  for (const plan of plans) {
    for (const entitlement of listMetadataEntitlements(plan.metadata)) {
      if (entitlement.enabled === false) continue;

      const featureEntitlements =
        entitlementsByFeatureKey.get(entitlement.featureKey) ??
        new Map<string, LinkedPlanEntitlementSummary>();

      featureEntitlements.set(plan.id, {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
        type: entitlement.type ?? "BOOLEAN",
        value: entitlement.value ?? null,
        valueUnit:
          typeof (entitlement as { valueUnit?: unknown }).valueUnit === "string"
            ? (entitlement as { valueUnit?: string | null }).valueUnit ?? null
            : null,
      });
      entitlementsByFeatureKey.set(entitlement.featureKey, featureEntitlements);
    }
  }

  return new Map(
    Array.from(entitlementsByFeatureKey.entries()).map(([featureKey, linkedEntitlements]) => [
      featureKey,
      Array.from(linkedEntitlements.values()).sort((left, right) => left.name.localeCompare(right.name)),
    ]),
  );
}
