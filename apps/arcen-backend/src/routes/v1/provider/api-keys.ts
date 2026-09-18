import type { Context } from "hono";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { generateApiKey } from "../../../lib/auth/api-key-auth.js";
import { requireTeamRoles, isErrorResponse } from "../../../lib/auth/api-auth.js";
import { requireResolvedActiveEnvironment } from "../../../lib/environments/workspace-environments.js";

export async function getApiKeys(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  const keys = await db.arcenApiKey.findMany({
    where: { teamId, environmentId: activeEnvironment.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return c.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    })),
  });
}

export async function createApiKey(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  let body: { name?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // name is optional
  }

  const name = (body.name ?? "").trim() || "API Key";

  const { raw: rawKey, hash: keyHash, prefix } = generateApiKey({
    type: "SECRET",
    mode: activeEnvironment.mode,
  });

  await db.providerProfile.upsert({
    where: {
      teamId_environmentId: {
        teamId,
        environmentId: activeEnvironment.id,
      },
    },
    update: { apiKeyHash: keyHash, apiKeyPrefix: prefix },
    create: {
      teamId,
      environmentId: activeEnvironment.id,
      apiKeyHash: keyHash,
      apiKeyPrefix: prefix,
    },
  });

  const keyRecord = await db.arcenApiKey.create({
    data: {
      teamId,
      environmentId: activeEnvironment.id,
      name,
      keyHash,
      prefix,
      type: "SECRET",
      environmentMode: activeEnvironment.mode,
    },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.generate",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    metadata: { prefix, name },
  });

  return c.json({
    key: rawKey,
    prefix,
    apiKey: {
      id: keyRecord.id,
      name: keyRecord.name,
      prefix: keyRecord.prefix,
      createdAt: keyRecord.createdAt.toISOString(),
      lastUsedAt: null,
    },
  });
}

export async function revokeApiKeys(c: Context) {
  const auth = await requireTeamRoles(c, ["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return c.json({ ok: false, error: auth.error }, auth.status as any as any);

  const { team } = auth;
  const teamId = team.teamId;
  const activeEnvironment = await requireResolvedActiveEnvironment(
    auth.session,
    teamId,
  );
  if (!activeEnvironment) {
    return c.json({ error: "No workspace environment selected" }, 409 as any);
  }

  await db.arcenApiKey.deleteMany({
    where: { teamId, environmentId: activeEnvironment.id },
  });

  await db.providerProfile.updateMany({
    where: { teamId, environmentId: activeEnvironment.id },
    data: { apiKeyHash: null, apiKeyPrefix: null },
  });

  await writeAuditEvent({
    headers: c.req.raw.headers,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.revoke",
    resourceType: "ProviderProfile",
    resourceId: teamId,
  });

  return c.json({ ok: true });
}
