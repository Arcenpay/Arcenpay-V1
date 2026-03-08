// ============================================================
//  Dashboard API — Team Members
//  DELETE /api/team/members?userId=xxx  — remove a member (OWNER/ADMIN only)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teamCtx = await resolveTeamContext(session);
    if (!teamCtx) {
      return NextResponse.json({ error: "No team found" }, { status: 403 });
    }

    if (teamCtx.teamRole !== "OWNER" && teamCtx.teamRole !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const userId = req.nextUrl.searchParams.get("userId");
    if (!userId) {
      return NextResponse.json(
        { error: "userId query param required" },
        { status: 400 },
      );
    }

    // Can't remove the team owner
    const member = await db.teamMember.findFirst({
      where: { teamId: teamCtx.teamId, userId },
    });

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    if (member.role === "OWNER") {
      return NextResponse.json(
        { error: "Cannot remove the team owner" },
        { status: 400 },
      );
    }

    await db.teamMember.delete({ where: { id: member.id } });

    await writeAuditEvent({
      request: req,
      teamId: teamCtx.teamId,
      userId: teamCtx.userId,
      walletAddress: teamCtx.walletAddress,
      action: "team.member.remove",
      resourceType: "TeamMember",
      resourceId: member.id,
      metadata: { userId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/team/members DELETE]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
