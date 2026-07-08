import { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";

type CreditDb = typeof db | Prisma.TransactionClient;

type PlanCreditGrant = {
  creditTypeId: string;
  amount: number;
  resetPeriod?: string | null;
  autoTopUp?: boolean;
};

export type CreditBurnConfig = {
  creditTypeId: string;
  amount: number;
};

export class CreditLedgerError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "CreditLedgerError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(numberValue) || numberValue <= 0) return null;
  return numberValue;
}

export function readPlanCreditGrants(metadata: unknown): PlanCreditGrant[] {
  const grants = asRecord(metadata).creditGrants;
  if (!Array.isArray(grants)) return [];

  return grants.flatMap((grant) => {
    const record = asRecord(grant);
    const creditTypeId = readString(record.creditTypeId);
    const amount = readPositiveInteger(record.amount);
    if (!creditTypeId || amount === null) return [];

    return [
      {
        creditTypeId,
        amount,
        resetPeriod: readString(record.resetPeriod),
        autoTopUp: record.autoTopUp === true,
      },
    ];
  });
}

function getPeriodKey(date: Date, billingPeriod?: string | null): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return billingPeriod === "annual" || billingPeriod === "yearly"
    ? `${year}`
    : `${year}-${month}-${day}`;
}

export function planCreditGrantIdempotencyKey(input: {
  companyId: string;
  planId: string;
  creditTypeId: string;
  billingPeriod?: string | null;
  periodStartedAt?: Date | null;
}): string {
  const periodKey = getPeriodKey(
    input.periodStartedAt ?? new Date(),
    input.billingPeriod,
  );
  return [
    "plan-credit",
    input.companyId,
    input.planId,
    input.creditTypeId,
    input.billingPeriod ?? "period",
    periodKey,
  ].join(":");
}

type GrantBalance = {
  id: string;
  remainingAmount: number;
  grantedAt: Date;
  expiresAt: Date | null;
  periodEndsAt?: Date | null;
};

export type CreditDebit = {
  grantId: string;
  amount: number;
  balanceAfter: number;
};

function compareNullableDate(left?: Date | null, right?: Date | null): number {
  if (left && right) return left.getTime() - right.getTime();
  if (left) return -1;
  if (right) return 1;
  return 0;
}

export function applyCreditDebitsToGrantBalances(
  grants: GrantBalance[],
  amount: number,
): CreditDebit[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new CreditLedgerError("Credit amount must be a positive integer", 400);
  }

  let remaining = amount;
  const debits: CreditDebit[] = [];
  const ordered = [...grants].sort((left, right) => {
    const expiryOrder = compareNullableDate(left.expiresAt, right.expiresAt);
    if (expiryOrder !== 0) return expiryOrder;
    const periodOrder = compareNullableDate(left.periodEndsAt, right.periodEndsAt);
    if (periodOrder !== 0) return periodOrder;
    return left.grantedAt.getTime() - right.grantedAt.getTime();
  });

  for (const grant of ordered) {
    if (remaining <= 0) break;
    if (grant.remainingAmount <= 0) continue;
    const debitAmount = Math.min(grant.remainingAmount, remaining);
    debits.push({
      grantId: grant.id,
      amount: debitAmount,
      balanceAfter: grant.remainingAmount - debitAmount,
    });
    remaining -= debitAmount;
  }

  if (remaining > 0) {
    throw new CreditLedgerError("Insufficient credits", 402);
  }

  return debits;
}

async function runSerializable<T>(
  client: CreditDb,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in client) {
    return client.$transaction(fn, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }
  return fn(client);
}

export async function grantCompanyCredits(
  input: {
    teamId: string;
    environmentId?: string | null;
    companyId: string;
    creditTypeId: string;
    amount: number;
    source: "PLAN_GRANT" | "CREDIT_BUNDLE" | "ADMIN" | "ADJUSTMENT";
    paymentId?: string | null;
    checkoutSessionId?: string | null;
    idempotencyKey?: string | null;
    periodStartedAt?: Date | null;
    periodEndsAt?: Date | null;
    expiresAt?: Date | null;
    resetPeriod?: string | null;
    metadata?: Record<string, unknown>;
  },
  client: CreditDb = db,
) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new CreditLedgerError("Credit grant amount must be a positive integer", 400);
  }

  return runSerializable(client, async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.companyCreditGrant.findFirst({
        where: { teamId: input.teamId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) return { grant: existing, duplicate: true as const };
    }

    const grant = await tx.companyCreditGrant.create({
      data: {
        teamId: input.teamId,
        environmentId: input.environmentId ?? null,
        companyId: input.companyId,
        creditTypeId: input.creditTypeId,
        source: input.source,
        initialAmount: input.amount,
        remainingAmount: input.amount,
        paymentId: input.paymentId ?? null,
        checkoutSessionId: input.checkoutSessionId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        periodStartedAt: input.periodStartedAt ?? null,
        periodEndsAt: input.periodEndsAt ?? null,
        expiresAt: input.expiresAt ?? null,
        resetPeriod: input.resetPeriod ?? null,
        metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
      },
    });

    await tx.creditLedgerEntry.create({
      data: {
        teamId: input.teamId,
        environmentId: input.environmentId ?? null,
        companyId: input.companyId,
        creditTypeId: input.creditTypeId,
        grantId: grant.id,
        kind: "GRANT",
        amount: input.amount,
        balanceAfter: input.amount,
        paymentId: input.paymentId ?? null,
        checkoutSessionId: input.checkoutSessionId ?? null,
        idempotencyKey: input.idempotencyKey
          ? `${input.idempotencyKey}:ledger`
          : null,
        metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
      },
    });

    return { grant, duplicate: false as const };
  });
}

export async function grantPlanCreditsForCompany(
  input: {
    teamId: string;
    environmentId?: string | null;
    companyId: string;
    planId: string;
    billingPeriod?: string | null;
    periodStartedAt?: Date | null;
    periodEndsAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
  client: CreditDb = db,
) {
  const plan = await client.catalogPlan.findFirst({
    where: { id: input.planId, teamId: input.teamId },
    select: { id: true, environmentId: true, metadata: true },
  });
  if (!plan) return { grants: [], skipped: true as const };

  const grants = readPlanCreditGrants(plan.metadata);
  const created = [];

  for (const grant of grants) {
    const creditType = await client.catalogCreditType.findFirst({
      where: {
        id: grant.creditTypeId,
        teamId: input.teamId,
        active: true,
        status: { not: "ARCHIVED" },
        ...(plan.environmentId ? { environmentId: plan.environmentId } : {}),
      },
      select: { id: true },
    });
    if (!creditType) continue;

    const idempotencyKey = planCreditGrantIdempotencyKey({
      companyId: input.companyId,
      planId: plan.id,
      creditTypeId: creditType.id,
      billingPeriod: input.billingPeriod,
      periodStartedAt: input.periodStartedAt,
    });

    const result = await grantCompanyCredits(
      {
        teamId: input.teamId,
        environmentId: input.environmentId ?? plan.environmentId ?? null,
        companyId: input.companyId,
        creditTypeId: creditType.id,
        amount: grant.amount,
        source: "PLAN_GRANT",
        idempotencyKey,
        periodStartedAt: input.periodStartedAt ?? null,
        periodEndsAt: input.periodEndsAt ?? null,
        expiresAt:
          grant.resetPeriod === "never" ? null : (input.periodEndsAt ?? null),
        resetPeriod: grant.resetPeriod ?? "plan_period",
        metadata: {
          ...(input.metadata ?? {}),
          planId: plan.id,
          billingPeriod: input.billingPeriod ?? null,
          autoTopUp: grant.autoTopUp ?? false,
        },
      },
      client,
    );
    created.push(result);
  }

  return { grants: created, skipped: false as const };
}

export async function grantAddOnCreditsForCompany(
  input: {
    teamId: string;
    environmentId?: string | null;
    companyId: string;
    catalogAddOnId: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown>;
  },
  client: CreditDb = db,
) {
  const addOn = await client.catalogAddOn.findFirst({
    where: { id: input.catalogAddOnId, teamId: input.teamId },
    select: { id: true, environmentId: true, metadata: true },
  });
  if (!addOn) return { grants: [], skipped: true as const };

  const grants = readPlanCreditGrants(addOn.metadata);
  const created = [];

  for (const grant of grants) {
    const creditType = await client.catalogCreditType.findFirst({
      where: {
        id: grant.creditTypeId,
        teamId: input.teamId,
        active: true,
        status: { not: "ARCHIVED" },
        ...(addOn.environmentId ? { environmentId: addOn.environmentId } : {}),
      },
      select: { id: true },
    });
    if (!creditType) continue;

    // Use a unique idempotency key for this grant
    const idempotencyKey = [
      "addon-credit",
      input.companyId,
      addOn.id,
      creditType.id,
      input.expiresAt ? input.expiresAt.getTime() : "never",
    ].join(":");

    const result = await grantCompanyCredits(
      {
        teamId: input.teamId,
        environmentId: input.environmentId ?? addOn.environmentId ?? null,
        companyId: input.companyId,
        creditTypeId: creditType.id,
        amount: grant.amount,
        source: "CREDIT_BUNDLE", // Credits from add-ons are bundles
        idempotencyKey,
        periodStartedAt: new Date(),
        expiresAt: input.expiresAt ?? (grant.resetPeriod === "never" ? null : null),
        resetPeriod: grant.resetPeriod ?? "never",
        metadata: {
          ...(input.metadata ?? {}),
          catalogAddOnId: addOn.id,
          autoTopUp: grant.autoTopUp ?? false,
        },
      },
      client,
    );
    created.push(result);
  }

  return { grants: created, skipped: false as const };
}

function readFeatureCost(metadata: unknown, featureKey: string): number | null {
  const record = asRecord(metadata);
  const creditCosts = asRecord(record.creditCosts);
  const directCost = readPositiveInteger(creditCosts[featureKey]);
  if (directCost !== null) return directCost;

  const burnFeatures = record.burnFeatures;
  if (Array.isArray(burnFeatures)) {
    for (const item of burnFeatures) {
      if (typeof item === "string" && item === featureKey) return 1;
      const itemRecord = asRecord(item);
      if (readString(itemRecord.featureKey) !== featureKey) continue;
      return (
        readPositiveInteger(itemRecord.amount) ??
        readPositiveInteger(itemRecord.rate) ??
        1
      );
    }
  }

  const consumingFeatureKeys = record.consumingFeatureKeys;
  if (
    Array.isArray(consumingFeatureKeys) &&
    consumingFeatureKeys.includes(featureKey)
  ) {
    return 1;
  }

  return null;
}

export async function resolveCreditBurnConfig(input: {
  teamId: string;
  environmentId?: string | null;
  featureKey: string;
}): Promise<CreditBurnConfig | null> {
  const explicitCreditKey = input.featureKey.startsWith("credit:")
    ? input.featureKey.slice("credit:".length)
    : null;

  if (explicitCreditKey) {
    const creditType = await db.catalogCreditType.findFirst({
      where: {
        teamId: input.teamId,
        active: true,
        status: { not: "ARCHIVED" },
        ...(input.environmentId ? { environmentId: input.environmentId } : {}),
        OR: [{ id: explicitCreditKey }, { code: explicitCreditKey }],
      },
      select: { id: true },
    });
    return creditType ? { creditTypeId: creditType.id, amount: 1 } : null;
  }

  const creditTypes = await db.catalogCreditType.findMany({
    where: {
      teamId: input.teamId,
      active: true,
      status: { not: "ARCHIVED" },
      ...(input.environmentId ? { environmentId: input.environmentId } : {}),
    },
    select: { id: true, metadata: true },
  });

  for (const creditType of creditTypes) {
    const amount = readFeatureCost(creditType.metadata, input.featureKey);
    if (amount !== null) return { creditTypeId: creditType.id, amount };
  }

  return null;
}

export async function consumeCompanyCredits(
  input: {
    teamId: string;
    environmentId?: string | null;
    companyId: string;
    creditTypeId: string;
    amount: number;
    featureKey?: string | null;
    eventId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
  },
  client: CreditDb = db,
) {
  return runSerializable(client, async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.creditLedgerEntry.findFirst({
        where: { teamId: input.teamId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return { consumed: Math.abs(existing.amount), duplicate: true as const };
      }
    }

    const now = new Date();
    const grants = await tx.companyCreditGrant.findMany({
      where: {
        teamId: input.teamId,
        companyId: input.companyId,
        creditTypeId: input.creditTypeId,
        status: "ACTIVE",
        remainingAmount: { gt: 0 },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        id: true,
        remainingAmount: true,
        grantedAt: true,
        expiresAt: true,
        periodEndsAt: true,
      },
    });

    const debits = applyCreditDebitsToGrantBalances(grants, input.amount);

    for (const [index, debit] of debits.entries()) {
      const updated = await tx.companyCreditGrant.updateMany({
        where: {
          id: debit.grantId,
          teamId: input.teamId,
          remainingAmount: { gte: debit.amount },
          status: "ACTIVE",
        },
        data: { remainingAmount: { decrement: debit.amount } },
      });
      if (updated.count !== 1) {
        throw new CreditLedgerError("Credit balance changed while consuming", 409);
      }

      await tx.creditLedgerEntry.create({
        data: {
          teamId: input.teamId,
          environmentId: input.environmentId ?? null,
          companyId: input.companyId,
          creditTypeId: input.creditTypeId,
          grantId: debit.grantId,
          kind: "CONSUME",
          amount: -debit.amount,
          balanceAfter: debit.balanceAfter,
          featureKey: input.featureKey ?? null,
          eventId: input.eventId ?? null,
          idempotencyKey:
            input.idempotencyKey && index === 0
              ? input.idempotencyKey
              : input.idempotencyKey
                ? `${input.idempotencyKey}:${debit.grantId}`
                : null,
          metadata: input.metadata ? toPrismaJson(input.metadata) : undefined,
        },
      });
    }

    return { consumed: input.amount, duplicate: false as const };
  });
}
