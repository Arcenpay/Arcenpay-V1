// ============================================================
//  Dashboard API — Team Members
//  DELETE /api/team/members?userId=xxx  — remove a member (OWNER/ADMIN only)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.teamId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.teamRole !== "OWNER" && session.teamRole !== "ADMIN") {
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
      where: { teamId: session.teamId, userId },
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

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/team/members DELETE]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
