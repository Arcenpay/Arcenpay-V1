import type { EntitlementResult } from "@arcenpay/internal-core";
import { Prisma } from "../../generated/client/client.js";
import { db } from "../../db.js";
import { invalidateUsageCache } from "../platform/event-aggregator.js";
import { invalidateFlagCache } from "../entitlements/flag-cache.js";
import {
  resolveCompany,
  resolveUser,
  type CompanyKeys,
  type UserKeys,
} from "../entitlements/flag-engine.js";
import { resolveEntitlementResult } from "../entitlements/entitlements.js";
import { touchEntityActivity } from "../platform/activity.js";
import {
  consumeCompanyCredits,
  CreditLedgerError,
  resolveCreditBurnConfig,
} from "./usage-credits.js";

type UsageEventStore = Pick<typeof db, "arcenEvent">;

export interface ConsumeEntitlementInput {
  teamId: string;
  companyKeys: CompanyKeys;
  userKeys?: UserKeys;
  featureKey: string;
  traits?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ConsumeEntitlementResult extends EntitlementResult {
  consumed: boolean;
}

export class ConsumeEntitlementError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ConsumeEntitlementError";
  }
}

function getMonthlyWindow(): { gte: Date } {
  const now = new Date();
  return { gte: new Date(now.getFullYear(), now.getMonth(), 1) };
}

function appendLimitReason(reason: string): string {
  return reason.includes("limit reached") ? reason : `${reason} · limit reached`;
}

function withArcenTraits(
  traits: Record<string, unknown> | undefined,
  metadata: Record<string, unknown>,
): Prisma.InputJsonValue {
  const existingArcen =
    traits && typeof traits.__arcen === "object" && traits.__arcen !== null
      ? (traits.__arcen as Record<string, unknown>)
      : {};

  return {
    ...(traits ?? {}),
    __arcen: {
      ...existingArcen,
      ...metadata,
    },
  } as Prisma.InputJsonValue;
}

async function findExistingIdempotentEvent(args: {
  tx: UsageEventStore;
  teamId: string;
  companyId: string;
  userId?: string | null;
  eventKey: string;
  idempotencyKey: string;
}) {
  const recentEvents = await args.tx.arcenEvent.findMany({
    where: {
      teamId: args.teamId,
      companyId: args.companyId,
      userId: args.userId ?? null,
      eventType: "track",
      name: args.eventKey,
    },
    orderBy: { sentAt: "desc" },
    take: 100,
    select: { id: true, traits: true },
  });

  return (
    recentEvents.find((event) => {
      const traits =
        event.traits && typeof event.traits === "object"
          ? (event.traits as Record<string, unknown>)
          : {};
      const arcen =
        traits.__arcen && typeof traits.__arcen === "object"
          ? (traits.__arcen as Record<string, unknown>)
          : {};
      return arcen.idempotencyKey === args.idempotencyKey;
    }) ?? null
  );
}

async function runSerializable<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2034" ||
        attempt === attempts - 1
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

export async function consumeMeteredEntitlement(
  input: ConsumeEntitlementInput,
): Promise<ConsumeEntitlementResult> {
  const [company, user] = await Promise.all([
    resolveCompany(input.teamId, input.companyKeys),
    input.userKeys ? resolveUser(input.teamId, input.userKeys) : Promise.resolve(null),
  ]);

  if (!company) {
    throw new ConsumeEntitlementError("Company context is required", 400);
  }

  const baseEntitlement = await resolveEntitlementResult({
    teamId: input.teamId,
    companyKeys: { internalId: company.id },
    userKeys: user ? { internalId: user.id } : undefined,
    featureKey: input.featureKey,
  });

  const flag = await db.catalogFeatureFlag.findFirst({
    where: { teamId: input.teamId, featureKey: input.featureKey },
    select: { eventKey: true, featureType: true },
  });

  const creditBurn = await resolveCreditBurnConfig({
    teamId: input.teamId,
    environmentId: company.environmentId ?? null,
    featureKey: input.featureKey,
  });

  const isMetered =
    Boolean(creditBurn) ||
    flag?.featureType === "event_based" ||
    baseEntitlement.allocation !== null;

  if (!isMetered) {
    throw new ConsumeEntitlementError(
      `Feature "${input.featureKey}" is not a metered entitlement`,
      400,
    );
  }

  const eventKey = flag?.eventKey ?? input.featureKey;
  const window = getMonthlyWindow();

  const transactionResult = await runSerializable(() =>
    db.$transaction(
      async (tx) => {
        if (input.idempotencyKey) {
          const existing = await findExistingIdempotentEvent({
            tx,
            teamId: input.teamId,
            companyId: company.id,
            userId: user?.id ?? null,
            eventKey,
            idempotencyKey: input.idempotencyKey,
          });

          if (existing) {
            return { consumed: true, duplicate: true, creditError: null };
          }
        }

        // Enforcement: fresh database count inside the transaction.
        // Do NOT use the cached baseEntitlement.enabled — it can be stale (up to 30s).
        if (baseEntitlement.allocation !== null) {
          const currentUsage = await tx.arcenEvent.count({
            where: {
              teamId: input.teamId,
              companyId: company.id,
              eventType: "track",
              name: eventKey,
              sentAt: window,
            },
          });

          if (currentUsage >= baseEntitlement.allocation) {
            return { consumed: false, duplicate: false, creditError: null };
          }
        } else if (!baseEntitlement.enabled && !creditBurn) {
          // Feature is disabled for a non-allocation reason (e.g. plan doesn't include it).
          // Since there's no allocation to count against, we trust the enabled flag.
          return { consumed: false, duplicate: false, creditError: null };
        }

        if (creditBurn) {
          try {
            await consumeCompanyCredits(
              {
                teamId: input.teamId,
                environmentId: company.environmentId ?? null,
                companyId: company.id,
                creditTypeId: creditBurn.creditTypeId,
                amount: creditBurn.amount,
                featureKey: input.featureKey,
                idempotencyKey: input.idempotencyKey
                  ? `usage-credit:${input.idempotencyKey}`
                  : undefined,
                metadata: {
                  eventKey,
                  source: "consume",
                },
              },
              tx,
            );
          } catch (error) {
            if (error instanceof CreditLedgerError && error.statusCode === 402) {
              return {
                consumed: false,
                duplicate: false,
                creditError: "Insufficient credits",
              };
            }
            throw error;
          }
        }

        await tx.arcenEvent.create({
          data: {
            teamId: input.teamId,
            eventType: "track",
            name: eventKey,
            companyId: company.id,
            userId: user?.id ?? null,
            traits: withArcenTraits(input.traits, {
              source: "consume",
              featureKey: input.featureKey,
              ...(input.idempotencyKey
                ? { idempotencyKey: input.idempotencyKey }
                : {}),
            }),
          },
        });

        return { consumed: true, duplicate: false, creditError: null };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    ),
  );

  await touchEntityActivity(company.id, user?.id ?? null);
  invalidateUsageCache(input.teamId, company.id, eventKey);
  invalidateFlagCache(`${input.teamId}:`);

  const finalEntitlement = await resolveEntitlementResult({
    teamId: input.teamId,
    companyKeys: { internalId: company.id },
    userKeys: user ? { internalId: user.id } : undefined,
    featureKey: input.featureKey,
  });

  if (!transactionResult.consumed && finalEntitlement.exceeded) {
    return {
      ...finalEntitlement,
      enabled: false,
      reason: appendLimitReason(finalEntitlement.reason),
      consumed: false,
    };
  }

  if (!transactionResult.consumed && transactionResult.creditError) {
    return {
      ...finalEntitlement,
      enabled: false,
      reason: transactionResult.creditError,
      consumed: false,
    };
  }

  if (creditBurn && transactionResult.consumed) {
    return {
      ...finalEntitlement,
      enabled: true,
      reason: transactionResult.duplicate
        ? finalEntitlement.reason
        : "Credit consumed",
      consumed: true,
    };
  }

  return {
    ...finalEntitlement,
    consumed: transactionResult.consumed,
  };
}
