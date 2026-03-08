// ============================================================
//  Dashboard API — Pending Team Invitations
//  GET    /api/team/invites         — list pending Clerk invitations
//  DELETE /api/team/invites?id=...  — revoke a pending invitation
//
//  Only OWNER/ADMIN may manage invitations.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

async function resolveOrgId(teamId: string): Promise<string | null> {
  const team = await db.team.findUnique({
    where: { id: teamId },
    select: { clerkOrgId: true },
  });
  return team?.clerkOrgId ?? null;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const team = await resolveTeamContext(session);
  if (!team)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId = await resolveOrgId(team.teamId);
  if (!orgId) {
    return NextResponse.json({ invitations: [] });
  }

  try {
    const client = await clerkClient();
    const result = await client.organizations.getOrganizationInvitationList({
      organizationId: orgId,
      status: ["pending"],
      limit: 100,
    });

    const invitations = result.data.map((inv) => ({
      id: inv.id,
      emailAddress: inv.emailAddress,
      role: (inv.publicMetadata as Record<string, unknown>)?.dbRole ?? "MEMBER",
      createdAt: inv.createdAt,
      expiresAt: (inv as unknown as Record<string, unknown>).expiresAt ?? null,
    }));

    return NextResponse.json({ invitations });
  } catch (err) {
    console.error("[api/team/invites GET]", err);
    return NextResponse.json(
      { error: "Failed to fetch invitations" },
      { status: 503 },
    );
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const team = await resolveTeamContext(session);
  if (!team)
    return NextResponse.json({ error: "No team found" }, { status: 403 });

  if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const invitationId = request.nextUrl.searchParams.get("id");
  if (!invitationId) {
    return NextResponse.json({ error: "Missing invitation id" }, { status: 400 });
  }

  const orgId = await resolveOrgId(team.teamId);
  if (!orgId) {
    return NextResponse.json({ error: "Team has no Clerk org" }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    await client.organizations.revokeOrganizationInvitation({
      organizationId: orgId,
      invitationId,
      requestingUserId: session.clerkUserId,
    });

    await writeAuditEvent({
      request,
      teamId: team.teamId,
      userId: team.userId,
      walletAddress: team.walletAddress,
      action: "team.invite.revoke",
      resourceType: "TeamMember",
      resourceId: invitationId,
      metadata: { invitationId },
    });

    return NextResponse.json({ ok: true, invitationId });
  } catch (err) {
    console.error("[api/team/invites DELETE]", err);
    return NextResponse.json(
      { error: "Failed to revoke invitation" },
      { status: 500 },
    );
  }
}
