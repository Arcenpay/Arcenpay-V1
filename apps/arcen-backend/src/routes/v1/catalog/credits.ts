import type { Context } from "hono";
import { z } from "zod";
import { db } from "../../../db.js";
import { requirePermission, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";
import { isAcceptedTokenSupportedOnChain } from "../../../lib/environments/supported-tokens.js";

const createSchema = z.object({
  name: z.string().min(1),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_\-]+$/i),
  unitName: z.string().min(1),
  unitsPerPack: z.coerce.number().int().positive(),
  price: z.coerce.number().positive(),
  acceptedToken: z.string().min(1),
  environmentMode: z.enum(["DEVELOPMENT", "PRODUCTION"]).default("DEVELOPMENT"),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  code: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_\-]+$/i)
    .optional(),
  unitName: z.string().min(1).optional(),
  unitsPerPack: z.coerce.number().int().positive().optional(),
  price: z.coerce.number().positive().optional(),
  acceptedToken: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).optional(),
  active: z.boolean().optional(),
});

export async function listCredits(c: Context) {
  const auth = await requirePermission(c, "catalog:read");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const status = c.req.query("status") || undefined;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const creditTypes = await db.catalogCreditType.findMany({
    where: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      ...(status && { status: status as "DRAFT" | "PUBLISHED" | "ARCHIVED" }),
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  return c.json({ creditTypes });
}

export async function createCredit(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const data = parsed.data;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  if (!isAcceptedTokenSupportedOnChain(activeEnvironment.chainId, data.acceptedToken)) {
    return c.json({
      error: `Accepted token must belong to ${activeEnvironment.name}'s configured chain.`,
    }, 400 as any);
  }
  const creditType = await db.catalogCreditType.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: activeEnvironment.mode,
      name: data.name,
      code: data.code,
      unitName: data.unitName,
      unitsPerPack: data.unitsPerPack,
      price: data.price.toFixed(6),
      acceptedToken: data.acceptedToken,
      status: "DRAFT",
      active: true,
      version: 1,
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: activeEnvironment.id,
      environmentMode: creditType.environmentMode,
      entityType: "CREDIT",
      entityId: creditType.id,
      version: 1,
      status: creditType.status,
      snapshot: creditType,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.create",
    resourceType: "CatalogCreditType",
    resourceId: creditType.id,
    afterData: creditType,
  });

  return c.json({ creditType }, 201 as any);
}

export async function updateCredit(c: Context) {
  const auth = await requirePermission(c, "catalog:write");
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const body = await c.req.json() .catch(() => ({}));
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.flatten().fieldErrors }, 400 as any);
  }

  const existing = await db.catalogCreditType.findFirst({
    where: { id: parsed.data.id, teamId: auth.team.teamId },
  });
  if (!existing) {
    return c.json({ error: "Credit type not found" }, 404 as any);
  }
  if (!existing.environmentId) {
    return c.json({ error: "Legacy credit types without environments cannot be edited here." }, 409 as any);
  }
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    auth.team.teamId,
  );
  if (!activeEnvironment || existing.environmentId !== activeEnvironment.id) {
    return c.json({ error: "Switch to this credit environment before editing it." }, 409 as any);
  }
  if (
    parsed.data.acceptedToken !== undefined &&
    !isAcceptedTokenSupportedOnChain(activeEnvironment.chainId, parsed.data.acceptedToken)
  ) {
    return c.json({
      error: `Accepted token must belong to ${activeEnvironment.name}'s configured chain.`,
    }, 400 as any);
  }

  const updated = await db.catalogCreditType.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.code !== undefined && { code: parsed.data.code }),
      ...(parsed.data.unitName !== undefined && {
        unitName: parsed.data.unitName,
      }),
      ...(parsed.data.unitsPerPack !== undefined && {
        unitsPerPack: parsed.data.unitsPerPack,
      }),
      ...(parsed.data.price !== undefined && {
        price: parsed.data.price.toFixed(6),
      }),
      ...(parsed.data.acceptedToken !== undefined && {
        acceptedToken: parsed.data.acceptedToken,
      }),
      ...(parsed.data.status !== undefined && { status: parsed.data.status }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      version: existing.version + 1,
      ...(parsed.data.status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  await db.catalogVersion.create({
    data: {
      teamId: auth.team.teamId,
      environmentId: existing.environmentId,
      environmentMode: updated.environmentMode,
      entityType: "CREDIT",
      entityId: updated.id,
      version: updated.version,
      status: updated.status,
      snapshot: updated,
      ...(updated.status === "PUBLISHED" && { publishedAt: new Date() }),
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId: auth.team.teamId,
    userId: auth.team.userId,
    walletAddress: auth.team.walletAddress,
    action: "catalog.credit.update",
    resourceType: "CatalogCreditType",
    resourceId: updated.id,
    beforeData: existing,
    afterData: updated,
  });

  return c.json({ creditType: updated });
}
