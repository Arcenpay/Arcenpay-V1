// ============================================================
//  Dashboard API — Provider API Keys
//  GET    /api/provider/api-keys  — list all API keys for team
//  POST   /api/provider/api-keys  — generate a new API key
//  DELETE /api/provider/api-keys  — revoke all keys from the legacy settings flow
//
//  The full key is returned ONCE on generation and never stored
//  in plaintext. Only a SHA-256 hash + display prefix is saved.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { generateApiKey } from "@/lib/api-key-auth";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

// ── GET — list keys ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  void request;
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

  const keys = await db.arcenApiKey.findMany({
    where: { teamId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return NextResponse.json({
    keys: keys.map((k) => ({
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    })),
  });
}

// ── POST — generate key ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

  let body: { name?: string } = {};
  try {
    body = await request.json();
  } catch {
    // name is optional
  }

  const name = (body.name ?? "").trim() || "API Key";

  const { raw: rawKey, hash: keyHash, prefix } = generateApiKey();

  // Also keep providerProfile in sync for legacy x402 auth
  await db.providerProfile.upsert({
    where: { teamId },
    update: { apiKeyHash: keyHash, apiKeyPrefix: prefix },
    create: { teamId, apiKeyHash: keyHash, apiKeyPrefix: prefix },
  });

  // Create named key record for display in the dashboard
  const keyRecord = await db.arcenApiKey.create({
    data: {
      teamId,
      name,
      keyHash,
      prefix,
    },
  });

  await writeAuditEvent({
    request,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.generate",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    metadata: { prefix, name },
  });

  return NextResponse.json({
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

// ── DELETE — revoke key ───────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

  await db.arcenApiKey.deleteMany({
    where: { teamId },
  });

  await db.providerProfile.updateMany({
    where: { teamId },
    data: { apiKeyHash: null, apiKeyPrefix: null },
  });

  await writeAuditEvent({
    request,
    teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.revoke",
    resourceType: "ProviderProfile",
    resourceId: teamId,
  });

  return NextResponse.json({ ok: true });
}
