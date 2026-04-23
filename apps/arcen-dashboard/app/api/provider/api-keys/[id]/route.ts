/**
 * DELETE /api/provider/api-keys/[id]  — Revoke a named API key by id
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { requireTeamRoles, isErrorResponse } from "@/lib/api-auth";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireTeamRoles(["OWNER", "ADMIN"]);
  if (isErrorResponse(auth)) return auth;

  const { team } = auth;
  const teamId = team.teamId;

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
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "provider.api_key.revoke",
    resourceType: "ArcenApiKey",
    resourceId: id,
    metadata: { prefix: keyRecord.prefix },
  });

  return NextResponse.json({ ok: true });
}
