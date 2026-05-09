import type { Context } from "hono";
import { z } from "zod";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { db } from "../../db.js";
import { invalidateFlagCache } from "../../lib/entitlements/flag-cache.js";

const createSchema = z.object({
  companyId: z.string().min(1),
  value: z.boolean(),
  reason: z.string().trim().max(240).optional().nullable(),
});

async function requireFlagForTeam(id: string, teamId: string) {
  return db.catalogFeatureFlag.findFirst({
    where: { id, teamId },
    select: { id: true, featureKey: true },
  });
}

export async function GET(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return c.json({ error: "Flag not found" }, 404 as any);
  }

  const overrides = await db.companyOverride.findMany({
    where: {
      teamId: auth.team.teamId,
      featureKey: flag.featureKey,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  return c.json({ data: overrides });
}

export async function POST(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return c.json({ error: "Flag not found" }, 404 as any);
  }

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const company = await db.arcenCompany.findFirst({
    where: { id: parsed.data.companyId, teamId: auth.team.teamId },
    select: { id: true },
  });
  if (!company) {
    return c.json({ error: "Company not found" }, 404 as any);
  }

  const override = await db.companyOverride.upsert({
    where: {
      companyId_featureKey: {
        companyId: parsed.data.companyId,
        featureKey: flag.featureKey,
      },
    },
    update: {
      value: parsed.data.value,
      reason: parsed.data.reason || null,
    },
    create: {
      teamId: auth.team.teamId,
      companyId: parsed.data.companyId,
      featureKey: flag.featureKey,
      value: parsed.data.value,
      reason: parsed.data.reason || null,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          email: true,
          walletAddress: true,
        },
      },
    },
  });

  invalidateFlagCache(`${auth.team.teamId}:`);

  return c.json({ data: override }, 201 as any);
}

export async function DELETE(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const id = c.req.param("id");
  const flag = await requireFlagForTeam(id, auth.team.teamId);
  if (!flag) {
    return c.json({ error: "Flag not found" }, 404 as any);
  }

  const companyId = c.req.query("companyId");
  if (!companyId) {
    return c.json({ error: "companyId query param required" }, 400 as any);
  }

  const existing = await db.companyOverride.findFirst({
    where: {
      teamId: auth.team.teamId,
      companyId,
      featureKey: flag.featureKey,
    },
    select: { id: true },
  });
  if (!existing) {
    return c.json({ error: "Override not found" }, 404 as any);
  }

  await db.companyOverride.delete({ where: { id: existing.id } });
  invalidateFlagCache(`${auth.team.teamId}:`);

  return c.json({ ok: true });
}
