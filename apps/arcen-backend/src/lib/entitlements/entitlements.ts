import type { EntitlementResult } from "@arcenpay/internal-core";
import { db } from "../../db.js";
import { aggregateUsage } from "../platform/event-aggregator.js";
import {
  resolveCompany,
  resolveUser,
  type CompanyKeys,
  type UserKeys,
} from "./flag-engine.js";
import { listMetadataEntitlements } from "../catalog/catalog-entitlements.js";

interface EntitlementEntry {
  featureName?: string;
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  enabled: boolean;
}

type ResolvedCompany = Awaited<ReturnType<typeof resolveCompany>>;
type ResolvedUser = Awaited<ReturnType<typeof resolveUser>>;

async function loadFlags(teamId: string, featureKeys?: string[]) {
  return db.catalogFeatureFlag.findMany({
    where: featureKeys?.length
      ? { teamId, featureKey: { in: featureKeys } }
      : { teamId },
    include: {
      rules: {
        orderBy: { priority: "asc" },
        include: { conditions: true },
      },
    },
    orderBy: { featureKey: "asc" },
  });
}

type LoadedFlag = Awaited<ReturnType<typeof loadFlags>>[number];

type LoadedOverride = Awaited<
  ReturnType<typeof db.companyOverride.findMany>
>[number];

type MetadataEntitlement = EntitlementEntry & {
  source: "plan" | "add_on";
  sourceId: string;
};

interface ResolveEntitlementResultsInput {
  teamId: string;
  companyKeys: CompanyKeys;
  userKeys?: UserKeys;
  featureKeys?: string[];
}

export interface ResolvedEntitlementResults {
  companyId?: string;
  userId?: string;
  entitlements: EntitlementResult[];
}

function listEntitlements(metadata: unknown): EntitlementEntry[] {
  return listMetadataEntitlements(metadata).filter((entry): entry is EntitlementEntry => {
    const candidate = entry as Partial<EntitlementEntry>;
    return (
      typeof candidate.type === "string" &&
      typeof candidate.enabled === "boolean"
    );
  });
}

function metadataEnabled(entitlement: MetadataEntitlement | undefined): boolean {
  if (!entitlement || !entitlement.enabled) return false;
  if (entitlement.type === "BOOLEAN") {
    return entitlement.value !== false;
  }
  return true;
}

async function loadMergedMetadataEntitlements(
  teamId: string,
  company: ResolvedCompany,
): Promise<Map<string, MetadataEntitlement>> {
  const merged = new Map<string, MetadataEntitlement>();

  if (company?.activePlanId) {
    const plan = await db.catalogPlan.findFirst({
      where: { id: company.activePlanId, teamId },
      select: { id: true, metadata: true },
    });

    if (plan) {
      for (const entitlement of listEntitlements(plan.metadata)) {
        merged.set(entitlement.featureKey, {
          ...entitlement,
          source: "plan",
          sourceId: plan.id,
        });
      }
    }
  }

  const activeAddOnIds = company?.activeAddOnIds ?? [];
  if (activeAddOnIds.length > 0) {
    const addOns = await db.catalogAddOn.findMany({
      where: { teamId, id: { in: activeAddOnIds } },
      select: { id: true, metadata: true },
    });

    for (const addOn of addOns) {
      for (const entitlement of listEntitlements(addOn.metadata)) {
        merged.set(entitlement.featureKey, {
          ...entitlement,
          source: "add_on",
          sourceId: addOn.id,
        });
      }
    }
  }

  return merged;
}

async function evaluateLoadedFlag(
  flag: LoadedFlag,
  context: {
    teamId: string;
    company: ResolvedCompany;
    user: ResolvedUser;
    overrides: Map<string, LoadedOverride>;
  },
): Promise<{ enabled: boolean; reason: string }> {
  const { company, overrides } = context;
  const manualRules = flag.rules.filter(
    (rule) =>
      rule.source !== "plan" &&
      !rule.conditions.some((condition) => condition.criteriaType === "base_plan"),
  );

  if (company) {
    const override = overrides.get(flag.featureKey);
    if (override) {
      return {
        enabled: override.value,
        reason: `Company override${override.reason ? `: ${override.reason}` : ""}`,
      };
    }
  }

  for (const rule of manualRules) {
    const conditionResults = await Promise.all(
      rule.conditions.map(async (cond) => {
        const values = Array.isArray(cond.values)
          ? (cond.values as string[])
          : [];

        switch (cond.criteriaType) {
          case "base_plan": {
            if (!company?.activePlanId) return false;
            return cond.operator === "is_one_of"
              ? values.includes(company.activePlanId)
              : !values.includes(company.activePlanId);
          }

          case "add_on": {
            if (!company) return false;
            if (cond.operator === "is_one_of") {
              return values.some((id) => company.activeAddOnIds.includes(id));
            }
            return !values.some((id) => company.activeAddOnIds.includes(id));
          }

          case "usage": {
            if (!company || !cond.metricKey || cond.metricValue === null) {
              return false;
            }

            const usage = await aggregateUsage(
              context.teamId,
              company.id,
              cond.metricKey,
              cond.metricPeriod ?? "monthly",
            );

            switch (cond.operator) {
              case "is_greater_than":
              case "gt":
                return usage > cond.metricValue;
              case "is_less_than":
              case "lt":
                return usage < cond.metricValue;
              case "gte":
                return usage >= cond.metricValue;
              case "lte":
                return usage <= cond.metricValue;
              case "equals":
              case "eq":
                return usage === cond.metricValue;
              case "not_equals":
              case "neq":
                return usage !== cond.metricValue;
              default:
                return false;
            }
          }

          case "company_trait": {
            if (!company || !cond.traitKey) return false;
            const traitValue = String(company.traits[cond.traitKey] ?? "");
            if (cond.operator === "is_one_of") return values.includes(traitValue);
            return traitValue === String(values[0] ?? "");
          }

          case "user_trait": {
            if (!context.user || !cond.traitKey) return false;
            const traitValue = String(context.user.traits[cond.traitKey] ?? "");
            if (cond.operator === "is_one_of") return values.includes(traitValue);
            return traitValue === String(values[0] ?? "");
          }

          case "zktls_claim": {
            if (!company || !cond.zktlsProviderId) return false;
            const proof = await db.zkTlsProof.findFirst({
              where: {
                teamId: context.teamId,
                companyId: company.id,
                providerId: cond.zktlsProviderId,
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
              select: { id: true },
            });
            return proof !== null;
          }

          default:
            return false;
        }
      }),
    );

    if (conditionResults.every(Boolean)) {
      return {
        enabled: rule.value,
        reason: `Rule ${rule.priority + 1} matched`,
      };
    }
  }

  return {
    enabled: flag.defaultValue,
    reason: "Default rule (no targeting rule matched)",
  };
}

function buildFallbackEntitlementResult(
  featureKey: string,
  metadataEntitlement?: MetadataEntitlement,
): EntitlementResult {
  return {
    key: featureKey,
    enabled: metadataEnabled(metadataEntitlement),
    reason: metadataEntitlement
      ? metadataEntitlement.source === "add_on"
        ? "Add-on entitlement"
        : "Plan entitlement"
      : "Flag not found",
    allocation:
      metadataEntitlement?.type === "NUMERIC" &&
      typeof metadataEntitlement.value === "number"
        ? Number(metadataEntitlement.value)
        : null,
    usage: 0,
    exceeded: false,
  };
}

function finalizeMeteredEntitlement(
  entitlement: EntitlementResult,
  usage: number,
): EntitlementResult {
  const exceeded =
    entitlement.allocation !== null && usage >= entitlement.allocation;

  if (!exceeded) {
    return {
      ...entitlement,
      usage,
      exceeded: false,
    };
  }

  const reason = entitlement.reason.includes("limit reached")
    ? entitlement.reason
    : `${entitlement.reason} · limit reached`;

  return {
    ...entitlement,
    enabled: false,
    reason,
    usage,
    exceeded: true,
  };
}

export async function resolveEntitlementResults(
  input: ResolveEntitlementResultsInput,
): Promise<ResolvedEntitlementResults> {
  const { teamId, companyKeys, userKeys, featureKeys } = input;

  const [company, user] = await Promise.all([
    resolveCompany(teamId, companyKeys),
    userKeys ? resolveUser(teamId, userKeys) : Promise.resolve(null),
  ]);

  const metadataEntitlements = await loadMergedMetadataEntitlements(teamId, company);

  const uniqueFeatureKeys = featureKeys
    ? Array.from(new Set(featureKeys))
    : undefined;

  const flags = await loadFlags(teamId, uniqueFeatureKeys);

  const flagMap = new Map(flags.map((flag) => [flag.featureKey, flag]));

  const candidateKeys = uniqueFeatureKeys?.length
    ? uniqueFeatureKeys
    : Array.from(
        new Set([
          ...flags.map((flag) => flag.featureKey),
          ...metadataEntitlements.keys(),
        ]),
      ).sort();

  let overrides = new Map<string, LoadedOverride>();
  if (company) {
    const loadedOverrides = await db.companyOverride.findMany({
      where: uniqueFeatureKeys?.length
        ? {
            teamId,
            companyId: company.id,
            featureKey: { in: candidateKeys },
          }
        : {
            teamId,
            companyId: company.id,
          },
    });

    overrides = new Map(
      loadedOverrides.map((override) => [override.featureKey, override]),
    );
  }

  const entitlements = await Promise.all(
    candidateKeys.map(async (featureKey) => {
      const flag = flagMap.get(featureKey);
      const metadataEntitlement = metadataEntitlements.get(featureKey);
      const hasCatalogAssignment = Boolean(
        company?.activePlanId || (company?.activeAddOnIds?.length ?? 0) > 0,
      );

      if (!flag) {
        const fallback = buildFallbackEntitlementResult(
          featureKey,
          metadataEntitlement,
        );

        if (
          company &&
          metadataEntitlement &&
          (metadataEntitlement.type === "NUMERIC" ||
            metadataEntitlement.type === "UNLIMITED")
        ) {
          const usage = await aggregateUsage(teamId, company.id, featureKey, "monthly");
          return finalizeMeteredEntitlement(fallback, usage);
        }

        return fallback;
      }

      const evaluated = await evaluateLoadedFlag(flag, {
        teamId,
        company,
        user,
        overrides,
      });
      const isFallbackRule =
        evaluated.reason === "Default rule (no targeting rule matched)";

      let enabled: boolean;
      let reason: string;

      // Rule priority: 1. Metadata entitlements > 2. Explicit global flag rules > 3. Suppress default > 4. Flag default
      if (metadataEntitlement) {
        // Plan/add-on metadata is the canonical source for catalog-based access.
        enabled = metadataEntitlement.enabled && metadataEnabled(metadataEntitlement);
        reason = enabled
          ? `Entitled by ${metadataEntitlement.source}`
          : `Entitlement disabled on ${metadataEntitlement.source}${metadataEntitlement.sourceId ? ` (${metadataEntitlement.sourceId})` : ""}`;
      } else if (!isFallbackRule) {
        // No catalog entitlement resolved this feature, so global flag rules can decide.
        enabled = evaluated.enabled;
        reason = evaluated.reason;
      } else if (hasCatalogAssignment) {
        // Company is on a plan but no metadata or rules match — suppress the default
        enabled = false;
        reason = "Not included in the current plan";
      } else {
        // No plan context — use flag default
        enabled = evaluated.enabled;
        reason = evaluated.reason;
      }

      const isMetered =
        flag.featureType === "event_based" ||
        metadataEntitlement?.type === "NUMERIC" ||
        metadataEntitlement?.type === "UNLIMITED";
      const allocation =
        metadataEntitlement?.type === "NUMERIC" &&
        typeof metadataEntitlement.value === "number"
          ? Number(metadataEntitlement.value)
          : null;
      const usage =
        isMetered && company
          ? await aggregateUsage(
              teamId,
              company.id,
              flag.eventKey ?? featureKey,
              "monthly",
            )
          : 0;

      const entitlement = {
        key: featureKey,
        enabled,
        reason,
        allocation,
        usage,
        exceeded: false,
      } satisfies EntitlementResult;

      if (isMetered) {
        return finalizeMeteredEntitlement(entitlement, usage);
      }

      return entitlement;
    }),
  );

  return {
    companyId: company?.id,
    userId: user?.id,
    entitlements,
  };
}

export async function resolveEntitlementResult(
  input: ResolveEntitlementResultsInput & { featureKey: string },
): Promise<EntitlementResult> {
  const result = await resolveEntitlementResults({
    ...input,
    featureKeys: [input.featureKey],
  });

  return (
    result.entitlements[0] ?? {
      key: input.featureKey,
      enabled: false,
      reason: "Flag not found",
      allocation: null,
      usage: 0,
      exceeded: false,
    }
  );
}
