/**
 * GET  /api/v1/api-keys   — List API keys for the authenticated team (dashboard session)
 * POST /api/v1/api-keys   — Create a new API key (raw key shown once)
 *
 * Note: This endpoint uses DASHBOARD session auth (Clerk), not API key auth.
 * Only authenticated team members can manage API keys.
 */

import type { Context } from "hono";
import { requirePermission, isErrorResponse } from "../../lib/auth/api-auth.js";
import {
  API_PERMISSIONS,
  generateApiKey,
  generateTemporaryAccessToken,
  hashApiKey,
  requireApiKey,
  isApiKeyError,
  TEMP_TOKEN_PREFIX,
  type ApiKeyTypeName,
} from "../../lib/auth/api-key-auth.js";
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
      type: true,
      permissions: true,
      expiresAt: true,
      revokedAt: true,
      environmentMode: true,
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

  let body: {
    name: string;
    description?: string;
    type?: ApiKeyTypeName;
    permissions?: string[];
    expiresInDays?: number | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }

  if (!body.name?.trim()) {
    return c.json({ error: "name is required" }, 400 as any);
  }

  const keyType: ApiKeyTypeName = body.type ?? "SECRET";
  if (!["SECRET", "PUBLISHABLE", "RESTRICTED"].includes(keyType)) {
    return c.json({ error: "type must be SECRET, PUBLISHABLE or RESTRICTED" }, 400 as any);
  }

  const permissions = Array.isArray(body.permissions)
    ? body.permissions.filter((permission) =>
        (API_PERMISSIONS as readonly string[]).includes(permission),
      )
    : [];
  if (keyType === "RESTRICTED" && permissions.length === 0) {
    return c.json(
      { error: "Restricted keys require at least one permission" },
      400 as any,
    );
  }
  const expiresInDays =
    typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays)
      ? Math.max(1, Math.min(body.expiresInDays, 365))
      : null;
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const keyCheck = await assertCanCreateApiKey(team.teamId, activeEnvironment.id);
  if (!keyCheck.allowed) {
    return c.json({
      error: "LIMIT_REACHED",
      message: keyCheck.reason,
    }, 409 as any);
  }

  const { raw, hash, prefix } = generateApiKey({
    type: keyType,
    mode: activeEnvironment.mode,
  });

  const apiKey = await db.arcenApiKey.create({
    data: {
      teamId: team.teamId,
      environmentId: activeEnvironment.id,
      name: body.name.trim(),
      keyHash: hash,
      prefix,
      description: body.description,
      type: keyType,
      permissions:
        keyType === "PUBLISHABLE" ? [] : permissions,
      expiresAt,
      environmentMode: activeEnvironment.mode,
    },
  });

  return c.json({
      data: {
        id: apiKey.id,
        name: apiKey.name,
        prefix,
        type: keyType,
        environmentMode: activeEnvironment.mode,
        expiresAt: expiresAt?.toISOString() ?? null,
        // Raw key only returned on creation — never again
        key: raw,
        createdAt: apiKey.createdAt,
      },
      warning: `Store this ${prefix} key securely. It will not be shown again.`,
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

  await db.arcenApiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return c.json({ ok: true, revoked: true });
}

export async function createTempToken(c: Context) {
  // Issued with a SECRET/RESTRICTED key (server-side) — never a publishable key.
  const auth = await requireApiKey(c.req.raw, {
    allow: ["SECRET", "RESTRICTED"],
    permissions: ["tokens.create"],
  });
  if (isApiKeyError(auth)) {
    return c.json({ ok: false, error: auth.error }, auth.status as any);
  }

  let body: { companyId?: string; ttlSeconds?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400 as any);
  }
  if (!body.companyId?.trim()) {
    return c.json({ error: "companyId is required" }, 400 as any);
  }

  const company = await db.arcenCompany.findFirst({
    where: {
      id: body.companyId.trim(),
      teamId: auth.teamId,
      ...(auth.environmentId
        ? { environmentId: auth.environmentId }
        : {}),
    },
    select: { id: true },
  });
  if (!company) {
    return c.json({ error: "Company not found in this workspace" }, 404 as any);
  }

  const ttlSeconds =
    typeof body.ttlSeconds === "number" && Number.isFinite(body.ttlSeconds)
      ? Math.max(60, Math.min(Math.floor(body.ttlSeconds), 900))
      : 600;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  const { raw, hash } = generateTemporaryAccessToken();

  await db.embedAccessToken.create({
    data: {
      teamId: auth.teamId,
      environmentId: auth.environmentId,
      companyId: company.id,
      tokenHash: hash,
      expiresAt,
    },
  });

  return c.json({
    data: {
      token: raw,
      prefix: TEMP_TOKEN_PREFIX,
      companyId: company.id,
      expiresAt: expiresAt.toISOString(),
      ttlSeconds,
    },
    warning: "Short-lived token for browser-side customer access. Expires automatically.",
  }, 201 as any);
}
