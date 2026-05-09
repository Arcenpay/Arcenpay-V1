/**
 * GET    /api/v1/companies/:id/overrides   — List company overrides
 * POST   /api/v1/companies/:id/overrides   — Set/update an override
 * DELETE /api/v1/companies/:id/overrides   — Remove an override (by featureKey query param)
 *
 * Authorization: Bearer api_xxx
 */

import type { Context } from "hono";
import { requireAnyAuth, isAnyAuthError } from "../../lib/auth/require-any-auth.js";
import { db } from "../../db.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";

export async function GET(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return c.json({ error: "Company not found" }, 404 as any);

  const overrides = await db.companyOverride.findMany({
    where: { companyId: id, teamId },
    orderBy: { createdAt: "desc" },
  });

  return c.json({ data: overrides });
}

export async function POST(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;

  let body: { featureKey: string; value: boolean; reason?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (typeof body.featureKey !== "string" || typeof body.value !== "boolean") {
    return c.json({ error: "featureKey (string) and value (boolean) are required" }, 400 as any);
  }

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return c.json({ error: "Company not found" }, 404 as any);

  const override = await db.companyOverride.upsert({
    where: {
      companyId_featureKey: { companyId: id, featureKey: body.featureKey },
    },
    create: {
      teamId,
      companyId: id,
      featureKey: body.featureKey,
      value: body.value,
      reason: body.reason,
    },
    update: {
      value: body.value,
      reason: body.reason,
    },
  });

  invalidateFlagCache(`${teamId}:`);

  return c.json({ data: override });
}

export async function DELETE(c: Context) {
  const ctx = await requireAnyAuth(c);
  if (isAnyAuthError(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const id = c.req.param("id");
  const { teamId } = ctx;
  const featureKey = c.req.query("featureKey");

  if (!featureKey) {
    return c.json({ error: "featureKey query param required" }, 400 as any);
  }

  const company = await db.arcenCompany.findFirst({
    where: { id, teamId },
    select: { id: true },
  });
  if (!company)
    return c.json({ error: "Company not found" }, 404 as any);

  await db.companyOverride.deleteMany({
    where: { companyId: id, featureKey },
  });

  invalidateFlagCache(`${teamId}:`);

  return c.json({ ok: true });
}
