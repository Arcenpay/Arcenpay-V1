import { NextResponse } from "next/server";
import { getSession, refreshSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await refreshSession(session.sessionId);

  const memberships = await db.teamMember.findMany({
    where: { userId: session.userId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const currentTeam =
    memberships.find((membership) => membership.teamId === session.currentTeamId) ??
    memberships[0] ??
    null;

  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      walletAddress: session.walletAddress,
    },
    currentTeam: currentTeam
      ? {
          id: currentTeam.team.id,
          name: currentTeam.team.name,
          slug: currentTeam.team.slug,
          role: currentTeam.role,
        }
      : null,
    teams: memberships.map((membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug,
      role: membership.role,
    })),
  });
}
