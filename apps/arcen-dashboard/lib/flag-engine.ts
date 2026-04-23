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
import { createPublicClient, http } from "viem";
import { sepolia, baseSepolia, base } from "viem/chains";
import { getContractAddresses } from "@arcenpay/sdk";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 11155111);
const RPC_URL = process.env.RPC_URL ?? "";

// Lazy-initialized viem client for on-chain reads
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _viemClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getViemClient(): any {
  if (!RPC_URL) return null;
  if (_viemClient) return _viemClient;
  const chain = CHAIN_ID === 8453 ? base : CHAIN_ID === 84532 ? baseSepolia : sepolia;
  _viemClient = createPublicClient({ chain, transport: http(RPC_URL) });
  return _viemClient;
}

// Minimal ABI subset for on-chain subscription lookup
const SUBSCRIPTION_REGISTRY_ABI = [
  {
    name: "getWalletSubscription",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "getPlanFeatures",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "onChainPlanId", type: "uint256" },
      { name: "planTier", type: "string" },
    ],
  },
] as const;

/**
 * Tries to read the on-chain subscription for a wallet and update the DB.
 * Returns the resolved activePlanId if found, null otherwise.
 * Called only when company.activePlanId is null and a wallet is available.
 */
async function resolveOnChainPlan(
  teamId: string,
  companyId: string,
  wallet: string,
): Promise<string | null> {
  const client = getViemClient();
  if (!client) return null;

  try {
    const contracts = getContractAddresses(CHAIN_ID);
    if (!contracts.subscriptionRegistry) return null;

    const tokenId = await client.readContract({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SUBSCRIPTION_REGISTRY_ABI,
      functionName: "getWalletSubscription",
      args: [wallet as `0x${string}`],
    });

    if (!tokenId || tokenId === 0n) return null;

    const [onChainPlanId] = await client.readContract({
      address: contracts.subscriptionRegistry as `0x${string}`,
      abi: SUBSCRIPTION_REGISTRY_ABI,
      functionName: "getPlanFeatures",
      args: [tokenId],
    });

    const plan = await db.catalogPlan.findFirst({
      where: { onChainPlanId: String(onChainPlanId), teamId },
      select: { id: true },
    });

    if (!plan) return null;

    // Fire-and-forget DB repair — future checks use the fast path
    db.arcenCompany
      .update({ where: { id: companyId }, data: { activePlanId: plan.id } })
      .catch(() => {});

    return plan.id;
  } catch {
    // On-chain read failed — not a hard error, just skip
    return null;
  }
}

export interface CompanyKeys {
  id?: string;        // caller's internal company ID (externalId)
  internalId?: string; // ArcenCompany.id
  wallet?: string;    // wallet address (checksummed or lowercase)
  email?: string;
}

export interface UserKeys {
  id?: string;        // caller's internal user ID (externalId)
  internalId?: string; // ArcenUser.id
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
  if (!keys.id && !keys.internalId && !keys.wallet && !keys.email) return null;

  const where: Record<string, unknown>[] = [];
  if (keys.internalId) where.push({ id: keys.internalId, teamId });
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
      subscriptionState: {
        select: {
          status: true,
          catalogPlanId: true,
          currentPeriodEnd: true,
        },
      },
    },
  });

  if (!company) return null;

  // Update lastSeenAt in background — non-blocking
  db.arcenCompany
    .update({ where: { id: company.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  let activePlanId =
    company.subscriptionState?.status === "ACTIVE" ||
    company.subscriptionState?.status === "PAST_DUE"
      ? company.subscriptionState.catalogPlanId ?? company.activePlanId
      : company.activePlanId;

  // On-chain fallback: if activePlanId is null but we have a wallet, try to resolve from chain
  if (!activePlanId && keys.wallet && !company.subscriptionState) {
    const onChainPlanId = await resolveOnChainPlan(teamId, company.id, keys.wallet.toLowerCase());
    if (onChainPlanId) activePlanId = onChainPlanId;
  }

  return {
    id: company.id,
    traits: (company.traits as Record<string, unknown>) ?? {},
    activePlanId,
    activeAddOnIds: Array.isArray(company.activeAddOnIds) ? (company.activeAddOnIds as string[]) : [],
  };
}

export async function resolveUser(
  teamId: string,
  keys: UserKeys,
): Promise<{ id: string; traits: Record<string, unknown> } | null> {
  if (!keys.id && !keys.internalId && !keys.clerkUserId && !keys.wallet) return null;

  const where: Record<string, unknown>[] = [];
  if (keys.internalId) where.push({ id: keys.internalId, teamId });
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
