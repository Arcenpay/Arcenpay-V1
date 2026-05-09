import { db } from "../../db.js";
import { toPrismaJson } from "../../utils/prisma-json.js";
import { toSix } from "./invoices.js";

type BillingAdjustmentDb = Pick<typeof db, "billingAdjustment">;

export async function recordBillingAdjustment(input: {
  teamId: string;
  companyId: string;
  subscriptionStateId?: string | null;
  paymentId?: string | null;
  kind:
    | "UPGRADE_PRORATION_CHARGE"
    | "DOWNGRADE_PRORATION_CREDIT"
    | "MANUAL_CREDIT"
    | "MANUAL_DEBIT";
  status?: "PENDING" | "POSTED" | "VOIDED";
  amount: number;
  currency?: string;
  fromCatalogPlanId?: string | null;
  toCatalogPlanId?: string | null;
  periodStartedAt?: Date | null;
  periodEndsAt?: Date | null;
  effectiveAt?: Date | null;
  postedAt?: Date | null;
  voidedAt?: Date | null;
  metadata?: Record<string, unknown>;
}, client: BillingAdjustmentDb = db) {
  return client.billingAdjustment.create({
    data: {
      teamId: input.teamId,
      companyId: input.companyId,
      subscriptionStateId: input.subscriptionStateId ?? null,
      paymentId: input.paymentId ?? null,
      kind: input.kind,
      status: input.status ?? "PENDING",
      amount: toSix(input.amount),
      currency: input.currency ?? "USDC",
      fromCatalogPlanId: input.fromCatalogPlanId ?? null,
      toCatalogPlanId: input.toCatalogPlanId ?? null,
      periodStartedAt: input.periodStartedAt ?? null,
      periodEndsAt: input.periodEndsAt ?? null,
      effectiveAt: input.effectiveAt ?? null,
      postedAt: input.postedAt ?? null,
      voidedAt: input.voidedAt ?? null,
      ...(input.metadata ? { metadata: toPrismaJson(input.metadata) } : {}),
    },
  });
}
