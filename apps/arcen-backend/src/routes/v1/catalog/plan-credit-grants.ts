import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { toPrismaNullableJson } from "../../../utils/prisma-json.js";

const creditGrantSchema = z.object({
  creditTypeId: z.string().min(1),
  amount: z.coerce.number().int().positive(),
  resetPeriod: z
    .enum(["plan_period", "monthly", "yearly", "never"])
    .default("plan_period"),
  autoTopUp: z.boolean().default(false),
});

function getCreditGrants(metadata: unknown): z.infer<typeof creditGrantSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.creditGrants)) return [];
  return meta.creditGrants as z.infer<typeof creditGrantSchema>[];
}

async function enrichCreditGrants(
  teamId: string,
  grants: z.infer<typeof creditGrantSchema>[],
) {
  if (grants.length === 0) return [];
  const creditTypes = await db.catalogCreditType.findMany({
    where: {
      teamId,
      id: { in: grants.map((grant) => grant.creditTypeId) },
    },
    select: {
      id: true,
      name: true,
      code: true,
      unitName: true,
      metadata: true,
    },
  });
  const creditTypeById = new Map(
    creditTypes.map((creditType) => [creditType.id, creditType]),
  );

  return grants.map((grant) => {
    const creditType = creditTypeById.get(grant.creditTypeId);
    return {
      ...grant,
      name: creditType?.name ?? grant.creditTypeId,
      code: creditType?.code ?? null,
      unitName: creditType?.unitName ?? "credits",
      unitNamePlural:
        creditType?.metadata &&
        typeof creditType.metadata === "object" &&
        !Array.isArray(creditType.metadata) &&
        typeof (creditType.metadata as Record<string, unknown>).unitNamePlural ===
          "string"
          ? ((creditType.metadata as Record<string, unknown>)
              .unitNamePlural as string)
          : creditType?.unitName ?? "credits",
    };
  });
}

export async function getPlanCreditGrants(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const creditGrants = await enrichCreditGrants(
    auth.team.teamId,
    getCreditGrants(plan.metadata),
  );
  return c.json({ creditGrants });
}

export async function addPlanCreditGrant(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = creditGrantSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const creditType = await db.catalogCreditType.findFirst({
    where: {
      id: parsed.data.creditTypeId,
      teamId: auth.team.teamId,
      ...(plan.environmentId ? { environmentId: plan.environmentId } : {}),
    },
    select: { id: true, status: true, active: true },
  });
  if (!creditType) {
    return c.json({ error: "Credit type not found in this plan environment" }, 404 as any);
  }
  if (!creditType.active || creditType.status === "ARCHIVED") {
    return c.json({ error: "Archived or inactive credit types cannot be granted to plans" }, 409 as any);
  }

  const existing = getCreditGrants(plan.metadata);
  if (existing.some((e) => e.creditTypeId === parsed.data.creditTypeId)) {
    return c.json({ error: "Credit type already granted on this plan" }, 409 as any);
  }

  const newGrants = [...existing, parsed.data];
  const updatedMeta = {
    ...((plan.metadata as Record<string, unknown>) ?? {}),
    creditGrants: newGrants,
  };

  const updated = await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.credit_grant.add",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: parsed.data,
  });

  return c.json(
    {
      creditGrants: await enrichCreditGrants(auth.team.teamId, newGrants),
      plan: updated,
    },
    201 as any,
  );
}

export async function deletePlanCreditGrant(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const creditTypeId = c.req.query("creditTypeId");

  if (!creditTypeId) {
    return c.json({ error: "creditTypeId is required" }, 400 as any);
  }

  const plan = await db.catalogPlan.findFirst({
    where: { id, teamId: auth.team.teamId },
  });
  if (!plan) {
    return c.json({ error: "Plan not found" }, 404 as any);
  }

  const existing = getCreditGrants(plan.metadata);
  const filtered = existing.filter((e) => e.creditTypeId !== creditTypeId);

  if (filtered.length === existing.length) {
    return c.json({ error: "Credit grant not found" }, 404 as any);
  }

  const updatedMeta = {
    ...((plan.metadata as Record<string, unknown>) ?? {}),
    creditGrants: filtered,
  };

  await db.catalogPlan.update({
    where: { id: plan.id },
    data: { metadata: toPrismaNullableJson(updatedMeta) },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.plan.credit_grant.remove",
    resourceType: "CatalogPlan",
    resourceId: plan.id,
    afterData: { creditTypeId },
  });

  return c.json({
    creditGrants: await enrichCreditGrants(auth.team.teamId, filtered),
  });
}
