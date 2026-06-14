import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";

const planGrantSchema = z.object({
  planId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  resetPeriod: z
    .enum(["plan_period", "monthly", "yearly", "never"])
    .default("plan_period"),
  autoTopUp: z.boolean().default(false),
});

type PlanCreditGrant = {
  creditTypeId: string;
  amount: number;
  resetPeriod?: "plan_period" | "monthly" | "yearly" | "never";
  autoTopUp?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getPlanCreditGrants(metadata: unknown): PlanCreditGrant[] {
  const creditGrants = asRecord(metadata).creditGrants;
  if (!Array.isArray(creditGrants)) return [];
  return creditGrants.filter((grant): grant is PlanCreditGrant => {
    if (!grant || typeof grant !== "object") return false;
    const candidate = grant as Record<string, unknown>;
    return (
      typeof candidate.creditTypeId === "string" &&
      typeof candidate.amount === "number"
    );
  });
}

function writePlanCreditGrants(
  metadata: unknown,
  creditGrants: PlanCreditGrant[],
): Record<string, unknown> {
  return {
    ...asRecord(metadata),
    creditGrants,
  };
}

export async function getCreditPlanGrants(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const plans = await db.catalogPlan.findMany({
    where: {
      teamId: auth.team.teamId,
      ...(creditType.environmentId ? { environmentId: creditType.environmentId } : {}),
    },
    select: {
      id: true,
      name: true,
      tier: true,
      status: true,
      metadata: true,
    },
    orderBy: [{ name: "asc" }],
  });

  const planGrants = plans.flatMap((plan) =>
    getPlanCreditGrants(plan.metadata)
      .filter((grant) => grant.creditTypeId === creditType.id)
      .map((grant) => ({
        planId: plan.id,
        planName: plan.name,
        planTier: plan.tier,
        planStatus: plan.status,
        amount: grant.amount,
        resetPeriod: grant.resetPeriod ?? "plan_period",
        autoTopUp: grant.autoTopUp ?? false,
      })),
  );

  return c.json({ planGrants });
}

export async function saveCreditPlanGrant(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = planGrantSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const plan = await db.catalogPlan.findFirst({
    where: {
      id: parsed.data.planId,
      teamId: auth.team.teamId,
      ...(creditType.environmentId ? { environmentId: creditType.environmentId } : {}),
    },
    select: { id: true, metadata: true },
  });
  if (!plan) {
    return c.json({ error: "Plan not found in this credit environment" }, 404 as any);
  }

  const existing = getPlanCreditGrants(plan.metadata);
  const nextGrant: PlanCreditGrant = {
    creditTypeId: creditType.id,
    amount: parsed.data.amount,
    resetPeriod: parsed.data.resetPeriod,
    autoTopUp: parsed.data.autoTopUp,
  };

  let newGrants: PlanCreditGrant[];
  if (existing.some((g) => g.creditTypeId === creditType.id)) {
    newGrants = existing.map((g) =>
      g.creditTypeId === creditType.id ? nextGrant : g,
    );
  } else {
    newGrants = [...existing, nextGrant];
  }

  const updatedMeta = writePlanCreditGrants(plan.metadata, newGrants);

  const updated = await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.plan_grant.save",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: { ...nextGrant, planId: plan.id },
  });

  return c.json({
    planGrant: {
      planId: plan.id,
      amount: nextGrant.amount,
      resetPeriod: nextGrant.resetPeriod,
      autoTopUp: nextGrant.autoTopUp,
    },
    plan: updated,
  });
}

export async function deleteCreditPlanGrant(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const planId = c.req.query("planId");

  if (!planId) {
    return c.json({ error: "planId is required" }, 400 as any);
  }

  const creditType = await db.catalogCreditType.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }

  const plan = await db.catalogPlan.findFirst({
    where: {
      id: planId,
      teamId: auth.team.teamId,
      ...(creditType.environmentId ? { environmentId: creditType.environmentId } : {}),
    },
    select: { id: true, metadata: true },
  });
  if (!plan) {
    return c.json({ error: "Plan not found in this credit environment" }, 404 as any);
  }

  const existing = getPlanCreditGrants(plan.metadata);
  const filtered = existing.filter((g) => g.creditTypeId !== creditType.id);

  if (filtered.length === existing.length) {
    return c.json({ error: "Plan grant not found" }, 404 as any);
  }

  const updatedMeta = writePlanCreditGrants(plan.metadata, filtered);

  await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.plan_grant.remove",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: { planId },
  });

  return c.json({ planGrants: filtered });
}
