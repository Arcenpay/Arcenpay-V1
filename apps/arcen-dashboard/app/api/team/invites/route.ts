// ============================================================
//  Dashboard API — Pending Team Invitations
//  GET    /api/team/invites
//  DELETE /api/team/invites?id=...
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const team = await resolveTeamContext(session);
  if (!team) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invitations = await db.teamInvitation.findMany({
    where: {
      teamId: team.teamId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return NextResponse.json({
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      emailAddress: invitation.email,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const team = await resolveTeamContext(session);
  if (!team) {
    return NextResponse.json({ error: "No team found" }, { status: 403 });
  }

  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invitationId = request.nextUrl.searchParams.get("id");
  if (!invitationId) {
    return NextResponse.json({ error: "Missing invitation id" }, { status: 400 });
  }

  const invitation = await db.teamInvitation.findFirst({
    where: { id: invitationId, teamId: team.teamId },
    select: { id: true },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  await db.teamInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditEvent({
    request,
    teamId: team.teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "team.invite.revoke",
    resourceType: "TeamInvitation",
    resourceId: invitation.id,
    metadata: { invitationId: invitation.id },
  });

  return NextResponse.json({ ok: true, invitationId: invitation.id });
}
