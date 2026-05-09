import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

const planGrantSchema = z.object({
  planId: z.string().min(1),
  amount: z.coerce.number().positive(),
});

function getPlanGrants(metadata: unknown): z.infer<typeof planGrantSchema>[] {
  if (!metadata || typeof metadata !== "object") return [];
  const meta = metadata as Record<string, unknown>;
  if (!Array.isArray(meta.planGrants)) return [];
  return meta.planGrants as z.infer<typeof planGrantSchema>[];
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

  const planGrants = getPlanGrants(creditType.metadata);
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

  const existing = getPlanGrants(creditType.metadata);
  const planId = parsed.data.planId;

  let newGrants;
  if (existing.some((g) => g.planId === planId)) {
    newGrants = existing.map((g) => (g.planId === planId ? parsed.data : g));
  } else {
    newGrants = [...existing, parsed.data];
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    planGrants: newGrants,
  };

  const updated = await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.plan_grant.save",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: parsed.data,
  });

  return c.json({ planGrants: newGrants, creditType: updated });
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

  const existing = getPlanGrants(creditType.metadata);
  const filtered = existing.filter((g) => g.planId !== planId);

  if (filtered.length === existing.length) {
    return c.json({ error: "Plan grant not found" }, 404 as any);
  }

  const updatedMeta = {
    ...((creditType.metadata as Record<string, unknown>) ?? {}),
    planGrants: filtered,
  };

  await db.catalogCreditType.update({
    where: { id: creditType.id },
    data: { metadata: updatedMeta },
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
