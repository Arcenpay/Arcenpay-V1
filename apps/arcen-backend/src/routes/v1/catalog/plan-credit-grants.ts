import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const creditGrantSchema = z.object({
  creditTypeId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

function getCreditGrants(metadata: unknown): z.infer<typeof creditGrantSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.creditGrants)) return [];
  return meta.creditGrants as z.infer<typeof creditGrantSchema>[];
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

  const creditGrants = getCreditGrants(plan.metadata);
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
    data: { metadata: updatedMeta },
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

  return c.json({ creditGrants: newGrants, plan: updated }, 201 as any);
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
    data: { metadata: updatedMeta },
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

  return c.json({ creditGrants: filtered });
}
