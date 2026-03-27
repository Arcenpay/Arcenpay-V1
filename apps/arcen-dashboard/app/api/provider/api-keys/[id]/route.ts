/**
 * DELETE /api/provider/api-keys/[id]  — Revoke a named API key by id
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

async function resolveTeamId(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<string | null> {
  const ctx = await resolveTeamContext(session);
  return ctx?.teamId ?? null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teamId = await resolveTeamId(session);
  if (!teamId)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  const { id } = await params;

  const keyRecord = await db.arcenApiKey.findFirst({
    where: { id, teamId },
    select: { id: true, prefix: true },
  });

  if (!keyRecord) {
    return NextResponse.json({ error: "API key not found" }, { status: 404 });
  }

  await db.arcenApiKey.delete({ where: { id } });

  await writeAuditEvent({
    request,
    teamId,
    userId: session.clerkUserId,
    action: "provider.api_key.revoke",
    resourceType: "ArcenApiKey",
    resourceId: id,
    metadata: { prefix: keyRecord.prefix },
  });

  return NextResponse.json({ ok: true });
}
