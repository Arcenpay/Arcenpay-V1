// ============================================================
//  Dashboard API — Provider API Keys
//  POST   /api/provider/api-keys  — generate a new API key
//  DELETE /api/provider/api-keys  — revoke current API key
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

// ── POST — generate key ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  const rawKey = `ak_live_${randomBytes(28).toString("hex")}`;
  const keyHash = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, 16);

  await db.providerProfile.upsert({
    where: { teamId },
    update: { apiKeyHash: keyHash, apiKeyPrefix: prefix },
    create: { teamId, apiKeyHash: keyHash, apiKeyPrefix: prefix },
  });

  await writeAuditEvent({
    request,
    teamId,
    userId: session.clerkUserId,
    action: "provider.api_key.generate",
    resourceType: "ProviderProfile",
    resourceId: teamId,
    metadata: { prefix },
  });

  return NextResponse.json({ key: rawKey, prefix });
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
