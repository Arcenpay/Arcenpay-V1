import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

const Schema = z.object({
  teamId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const membership = await db.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: session.userId,
        teamId: parsed.data.teamId,
      },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!membership) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  await db.user.update({
    where: { id: session.userId },
    data: { currentTeamId: parsed.data.teamId },
  });

  return NextResponse.json({
    ok: true,
    currentTeam: {
      id: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug,
      role: membership.role,
    },
  });
}
