import { db } from "../../db.js";

export interface MetadataEntitlementLink {
  featureKey: string;
  enabled?: boolean;
  type?: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value?: boolean | number | null;
  valueUnit?: string | null;
}

export type CatalogBillingPeriod = "monthly" | "annual";

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

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function normalizeCatalogBillingPeriod(
  value: unknown,
): CatalogBillingPeriod {
  if (typeof value !== "string") return "monthly";
  const normalized = value.trim().toLowerCase();
  return normalized === "annual" || normalized === "yearly"
    ? "annual"
    : "monthly";
}

function readSharedMetadataEntitlements(metadata: unknown): unknown[] {
  const record = asRecord(metadata);
  const shared = record.entitlements;
  if (Array.isArray(shared)) return shared;

  // Backward compatibility for plans edited while annual entitlements existed.
  const legacyAnnual = record.annualEntitlements;
  return Array.isArray(legacyAnnual) ? legacyAnnual : [];
}

function filterMetadataEntitlements(
  entitlements: unknown[],
): MetadataEntitlementLink[] {
  return entitlements.filter((entry): entry is MetadataEntitlementLink => {
    if (!entry || typeof entry !== "object") return false;

    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.featureKey === "string" &&
      (candidate.enabled === undefined || typeof candidate.enabled === "boolean")
    );
  });
}

export function listDirectMetadataEntitlements(
  metadata: unknown,
  _billingPeriod: CatalogBillingPeriod = "monthly",
): MetadataEntitlementLink[] {
  return filterMetadataEntitlements(readSharedMetadataEntitlements(metadata));
}

export function hasDirectMetadataEntitlements(
  metadata: unknown,
  _billingPeriod: CatalogBillingPeriod = "monthly",
): boolean {
  return readSharedMetadataEntitlements(metadata).length > 0;
}

export function listMetadataEntitlements(
  metadata: unknown,
  _billingPeriod: CatalogBillingPeriod = "monthly",
): MetadataEntitlementLink[] {
  return listDirectMetadataEntitlements(metadata);
}

export function listAllMetadataEntitlements(
  metadata: unknown,
): MetadataEntitlementLink[] {
  return listMetadataEntitlements(metadata);
}

export function writeMetadataEntitlements(input: {
  metadata: unknown;
  billingPeriod?: CatalogBillingPeriod;
  entitlements: MetadataEntitlementLink[];
}): Record<string, unknown> {
  const { annualEntitlements: _legacyAnnualEntitlements, ...rest } = asRecord(
    input.metadata,
  ) as Record<string, unknown> & { annualEntitlements?: unknown };
  return {
    ...rest,
    entitlements: input.entitlements,
  };
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

  const linkedPlansByFeatureKey = new Map<
    string,
    Map<string, LinkedPlanSummary>
  >();

  for (const plan of plans) {
    for (const entitlement of listAllMetadataEntitlements(plan.metadata)) {
      if (entitlement.enabled === false) continue;

      const plansForFeature =
        linkedPlansByFeatureKey.get(entitlement.featureKey) ??
        new Map<string, LinkedPlanSummary>();
      plansForFeature.set(plan.id, {
        id: plan.id,
        name: plan.name,
        tier: plan.tier,
      });
      linkedPlansByFeatureKey.set(entitlement.featureKey, plansForFeature);
    }
  }

  return new Map(
    Array.from(linkedPlansByFeatureKey.entries()).map(
      ([featureKey, linkedPlans]) => [
        featureKey,
        Array.from(linkedPlans.values()).sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      ],
    ),
  );
}

export async function loadPublishedPlanEntitlementsByFeatureKey(
  teamId: string,
  environmentId?: string | null,
) {
  const plans = await db.catalogPlan.findMany({
    where: {
      teamId,
      active: true,
      status: "PUBLISHED",
      ...(environmentId ? { environmentId } : {}),
    },
    select: {
      id: true,
      name: true,
      tier: true,
      metadata: true,
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  const entitlementsByFeatureKey = new Map<
    string,
    Map<string, LinkedPlanEntitlementSummary>
  >();

  for (const plan of plans) {
    for (const entitlement of listAllMetadataEntitlements(plan.metadata)) {
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
          typeof entitlement.valueUnit === "string"
            ? entitlement.valueUnit ?? null
            : null,
      });
      entitlementsByFeatureKey.set(entitlement.featureKey, featureEntitlements);
    }
  }

  return new Map(
    Array.from(entitlementsByFeatureKey.entries()).map(
      ([featureKey, linkedEntitlements]) => [
        featureKey,
        Array.from(linkedEntitlements.values()).sort((left, right) =>
          left.name.localeCompare(right.name),
        ),
      ],
    ),
  );
}
