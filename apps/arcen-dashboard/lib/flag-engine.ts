/**
 * ArcenPay Web3 Flag Evaluation Engine
 *
 * Evaluates feature flags using priority-ordered targeting rules.
 * Web3-native flag check system.
 *
 * Evaluation order:
 *  1. Company overrides (always win)
 *  2. Targeting rules (priority order, first match wins)
 *  3. Flag default value (always false)
 */

import { db } from "@/lib/db";
import { aggregateUsage } from "@/lib/event-aggregator";
import { getCachedFlag, setCachedFlag } from "@/lib/flag-cache";

export interface CompanyKeys {
  id?: string;        // caller's internal company ID (externalId)
  wallet?: string;    // wallet address (checksummed or lowercase)
  email?: string;
}

export interface UserKeys {
  id?: string;        // caller's internal user ID (externalId)
  clerkUserId?: string;
  wallet?: string;
}

export interface FlagCheckResult {
  flag: string;
  value: boolean;
  reason: string;
  companyId?: string;
  userId?: string;
}

// ─── Company + User Resolution ────────────────────────────────────────────────

export async function resolveCompany(
  teamId: string,
  keys: CompanyKeys,
): Promise<{ id: string; traits: Record<string, unknown>; activePlanId: string | null; activeAddOnIds: string[] } | null> {
  if (!keys.id && !keys.wallet && !keys.email) return null;

  const where: Record<string, unknown>[] = [];
  if (keys.id) where.push({ teamId, externalId: keys.id });
  if (keys.wallet) where.push({ teamId, walletAddress: keys.wallet.toLowerCase() });
  if (keys.email) where.push({ teamId, email: keys.email });

  const company = await db.arcenCompany.findFirst({
    where: { OR: where },
    select: {
      id: true,
      traits: true,
      activePlanId: true,
      activeAddOnIds: true,
    },
  });

  if (!company) return null;

  // Update lastSeenAt in background — non-blocking
  db.arcenCompany
    .update({ where: { id: company.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    id: company.id,
    traits: (company.traits as Record<string, unknown>) ?? {},
    activePlanId: company.activePlanId,
    activeAddOnIds: Array.isArray(company.activeAddOnIds) ? (company.activeAddOnIds as string[]) : [],
  };
}

export async function resolveUser(
  teamId: string,
  keys: UserKeys,
): Promise<{ id: string; traits: Record<string, unknown> } | null> {
  if (!keys.id && !keys.clerkUserId && !keys.wallet) return null;

  const where: Record<string, unknown>[] = [];
  if (keys.id) where.push({ teamId, externalId: keys.id });
  if (keys.clerkUserId) where.push({ teamId, clerkUserId: keys.clerkUserId });
  if (keys.wallet) where.push({ teamId, walletAddress: keys.wallet.toLowerCase() });

  const user = await db.arcenUser.findFirst({
    where: { OR: where },
    select: { id: true, traits: true },
  });

  if (!user) return null;

  db.arcenUser
    .update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return { id: user.id, traits: (user.traits as Record<string, unknown>) ?? {} };
}

// ─── Condition Evaluation ─────────────────────────────────────────────────────

type Condition = {
  criteriaType: string;
  operator: string;
  values: unknown;
  metricKey: string | null;
  metricValue: number | null;
  metricPeriod: string | null;
  traitKey: string | null;
  zktlsProviderId: string | null;
};

function applyOperator(operator: string, left: unknown, right: unknown): boolean {
  const l = String(left ?? "").toLowerCase();
  const r = String(right ?? "").toLowerCase();
  switch (operator) {
    case "equals":
    case "eq":
      return l === r;
    case "not_equals":
    case "neq":
      return l !== r;
    case "contains":
      return l.includes(r);
    case "not_contains":
      return !l.includes(r);
    case "is_greater_than":
    case "gt":
      return Number(left) > Number(right);
    case "is_less_than":
    case "lt":
      return Number(left) < Number(right);
    case "gte":
      return Number(left) >= Number(right);
    case "lte":
      return Number(left) <= Number(right);
    default:
      return false;
  }
}

async function evaluateCondition(
  condition: Condition,
  context: {
    teamId: string;
    company: { id: string; traits: Record<string, unknown>; activePlanId: string | null; activeAddOnIds: string[] } | null;
    user: { id: string; traits: Record<string, unknown> } | null;
  },
): Promise<boolean> {
  const { criteriaType, operator, values, metricKey, metricValue, metricPeriod, traitKey, zktlsProviderId } = condition;
  const valArr = Array.isArray(values) ? (values as string[]) : [];

  switch (criteriaType) {
    case "base_plan": {
      if (!context.company?.activePlanId) return false;
      // values = array of CatalogPlan IDs
      return operator === "is_one_of"
        ? valArr.includes(context.company.activePlanId)
        : !valArr.includes(context.company.activePlanId);
    }

    case "add_on": {
      if (!context.company) return false;
      const activeAddOns = context.company.activeAddOnIds;
      if (operator === "is_one_of") {
        return valArr.some((id) => activeAddOns.includes(id));
      }
      return !valArr.some((id) => activeAddOns.includes(id));
    }

    case "usage": {
      if (!context.company || !metricKey || metricValue === null) return false;
      const count = await aggregateUsage(context.teamId, context.company.id, metricKey, metricPeriod ?? "monthly");
      return applyOperator(operator, count, metricValue);
    }

    case "company_trait": {
      if (!context.company || !traitKey) return false;
      const traitVal = context.company.traits[traitKey];
      if (operator === "is_one_of") return valArr.includes(String(traitVal ?? ""));
      return applyOperator(operator, traitVal, valArr[0] ?? "");
    }

    case "user_trait": {
      if (!context.user || !traitKey) return false;
      const traitVal = context.user.traits[traitKey];
      if (operator === "is_one_of") return valArr.includes(String(traitVal ?? ""));
      return applyOperator(operator, traitVal, valArr[0] ?? "");
    }

    case "zktls_claim": {
      if (!zktlsProviderId || !context.company) return false;
      const proof = await db.zkTlsProof.findFirst({
        where: {
          teamId: context.teamId,
          companyId: context.company.id,
          providerId: zktlsProviderId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        select: { id: true },
      });
      return proof !== null;
    }

    default:
      return false;
  }
}

// ─── Main Flag Evaluation ──────────────────────────────────────────────────────

export async function evaluateFlag(
  teamId: string,
  featureKey: string,
  companyKeys: CompanyKeys,
  userKeys?: UserKeys,
): Promise<FlagCheckResult> {
  const cacheKey = `flag:${teamId}:${featureKey}:${JSON.stringify(companyKeys)}:${JSON.stringify(userKeys ?? {})}`;

  // Try cache first (30s TTL)
  const cached = await getCachedFlag(cacheKey);
  if (cached) return cached as FlagCheckResult;

  // Load flag + rules
  const flag = await db.catalogFeatureFlag.findUnique({
    where: { teamId_featureKey: { teamId, featureKey } },
    include: {
      rules: {
        orderBy: { priority: "asc" },
        include: { conditions: true },
      },
    },
  });

  if (!flag) {
    return { flag: featureKey, value: false, reason: "Flag not found" };
  }

  // Resolve company and user in parallel
  const [company, user] = await Promise.all([
    resolveCompany(teamId, companyKeys),
    userKeys ? resolveUser(teamId, userKeys) : Promise.resolve(null),
  ]);

  const context = { teamId, company, user };

  // Check company-level overrides first (always win)
  if (company) {
    const override = await db.companyOverride.findUnique({
      where: { companyId_featureKey: { companyId: company.id, featureKey } },
    });
    if (override) {
      const result: FlagCheckResult = {
        flag: featureKey,
        value: override.value,
        reason: `Company override${override.reason ? `: ${override.reason}` : ""}`,
        companyId: company.id,
        userId: user?.id,
      };
      await setCachedFlag(cacheKey, result, 30);
      return result;
    }
  }

  // Evaluate targeting rules in priority order
  for (const rule of flag.rules) {
    // All conditions must match (AND logic)
    const conditionResults = await Promise.all(
      rule.conditions.map((cond) =>
        evaluateCondition(
          {
            criteriaType: cond.criteriaType,
            operator: cond.operator,
            values: cond.values,
            metricKey: cond.metricKey,
            metricValue: cond.metricValue,
            metricPeriod: cond.metricPeriod,
            traitKey: cond.traitKey,
            zktlsProviderId: cond.zktlsProviderId,
          },
          context,
        ),
      ),
    );

    if (conditionResults.every(Boolean)) {
      const result: FlagCheckResult = {
        flag: featureKey,
        value: rule.value,
        reason: `Rule ${rule.priority + 1} matched`,
        companyId: company?.id,
        userId: user?.id,
      };
      await setCachedFlag(cacheKey, result, 30);
      return result;
    }
  }

  // Default rule
  const result: FlagCheckResult = {
    flag: featureKey,
    value: flag.defaultValue,
    reason: "Default rule (no targeting rule matched)",
    companyId: company?.id,
    userId: user?.id,
  };
  await setCachedFlag(cacheKey, result, 30);
  return result;
}

// ─── Bulk flag evaluation ────────────────────────────────────────────────────

export async function evaluateFlags(
  teamId: string,
  featureKeys: string[],
  companyKeys: CompanyKeys,
  userKeys?: UserKeys,
): Promise<FlagCheckResult[]> {
  return Promise.all(
    featureKeys.map((key) => evaluateFlag(teamId, key, companyKeys, userKeys)),
  );
}
