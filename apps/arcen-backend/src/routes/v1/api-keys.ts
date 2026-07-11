/**
 * GET  /api/v1/api-keys   — List API keys for the authenticated team (dashboard session)
 * POST /api/v1/api-keys   — Create a new API key (raw key shown once)
 *
 * Note: This endpoint uses DASHBOARD session auth (Clerk), not API key auth.
 * Only authenticated team members can manage API keys.
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import { generateApiKey } from "../../lib/auth/api-key-auth.js";
import { db } from "../../db.js";
import { requireResolvedActiveEnvironment } from "../../lib/environments/workspace-environments.js";
import { assertCanCreateApiKey } from "../../lib/catalog/tier-guard.js";

export async function GET(c: Context) {
  const ctx = await requirePermission(c, "catalog:read");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    ctx.session,
    team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const keys = await db.arcenApiKey.findMany({
    where: { teamId: team.teamId, environmentId: activeEnvironment.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      description: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });

  return c.json({ data: keys });
}

export async function POST(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    ctx.session,
    team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  let body: { name: string; description?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400 as any);
  }

  const keyCheck = await assertCanCreateApiKey(team.teamId, activeEnvironment.id);
  if (!keyCheck.allowed) {
    return c.json({
      error: "LIMIT_REACHED",
      message: keyCheck.reason,
    }, 409 as any);
  }

  const { raw, hash, prefix } = generateApiKey();

  const apiKey = await db.arcenApiKey.create({
    data: {
      teamId: team.teamId,
      environmentId: activeEnvironment.id,
      name: body.name.trim(),
      keyHash: hash,
      prefix,
      description: body.description,
    },
  });

  return c.json({
      data: {
        id: apiKey.id,
        name: apiKey.name,
        prefix,
        // Raw key only returned on creation — never again
        key: raw,
        createdAt: apiKey.createdAt,
      },
      warning: "Store this API key securely. It will not be shown again.",
    }, 201 as any);
}

export async function DELETE(c: Context) {
  const ctx = await requirePermission(c, "catalog:write");
  if (isErrorResponse(ctx)) return c.json({ ok: false, error: ctx.error }, ctx.status as any);

  const { team } = ctx;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    ctx.session,
    team.teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }
  const keyId = c.req.query("id");

  if (!keyId) {
    return c.json({ error: "id query param required" }, 400 as any);
  }

  const key = await db.arcenApiKey.findFirst({
    where: {
      id: keyId,
      teamId: team.teamId,
      environmentId: activeEnvironment.id,
    },
  });

  if (!key) {
    return c.json({ error: "API key not found" }, 404 as any);
  }

  await db.arcenApiKey.delete({ where: { id: keyId } });

  return c.json({ ok: true });
}
