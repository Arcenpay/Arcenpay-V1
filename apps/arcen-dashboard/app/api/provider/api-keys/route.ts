// ============================================================
//  Dashboard API — Provider API Keys
//  GET    /api/provider/api-keys  — list all API keys for team
//  POST   /api/provider/api-keys  — generate a new API key
//  DELETE /api/provider/api-keys  — revoke current (legacy) API key
//
//  The full key is returned ONCE on generation and never stored
//  in plaintext. Only a SHA-256 hash + display prefix is saved.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

async function resolveTeamId(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<string | null> {
  const ctx = await resolveTeamContext(session);
  return ctx?.teamId ?? null;
}

// ── GET — list keys ───────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  void request;
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

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
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  let body: { name?: string } = {};
  try {
    body = await request.json();
  } catch {
    // name is optional
  }

  const name = (body.name ?? "").trim() || "API Key";

  const rawKey = `ak_live_${randomBytes(28).toString("hex")}`;
  const keyHash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, 16);

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
    userId: session.clerkUserId,
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
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  await db.providerProfile.updateMany({
    where: { teamId },
    data: { apiKeyHash: null, apiKeyPrefix: null },
  });

  await writeAuditEvent({
    request,
    teamId,
    userId: session.clerkUserId,
    action: "provider.api_key.revoke",
    resourceType: "ProviderProfile",
    resourceId: teamId,
  });

  return NextResponse.json({ ok: true });
}
