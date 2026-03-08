// ============================================================
//  Dashboard API — Team Info
//  GET  /api/team   — get current team info + members
//  PUT  /api/team   — update team name (OWNER/ADMIN only)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { slugify } from "@/lib/auth";
import { writeAuditEvent } from "@/lib/audit";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const teamCtx = await resolveTeamContext(session);
    if (!teamCtx) {
      return NextResponse.json({ error: "No team found" }, { status: 403 });
    }

    const team = await db.team.findUnique({
      where: { id: teamCtx.teamId },
      include: {
        members: {
          include: {
            user: { select: { id: true, email: true, walletAddress: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const members = team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      email: m.user.email,
      walletAddress: m.user.walletAddress,
      joinedAt: m.createdAt,
    }));

    return NextResponse.json({
      id: team.id,
      name: team.name,
      slug: team.slug,
      createdAt: team.createdAt,
      members,
      myRole: teamCtx.teamRole,
    });
  } catch (err) {
    console.error("[api/team GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

const PutSchema = z.object({
  name: z.string().min(1).max(64),
});

export async function PUT(req: NextRequest) {
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

    const body = await req.json();
    const parsed = PutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const { name } = parsed.data;
    let slug = slugify(name);

    // Check slug collision (only if it changed)
    const existing = await db.team.findUnique({
      where: { id: teamCtx.teamId },
    });
    if (existing && slugify(existing.name) !== slug) {
      const clash = await db.team.findFirst({
        where: { slug, id: { not: teamCtx.teamId } },
      });
      if (clash) slug = `${slug}-${Date.now()}`;
    }

    const team = await db.team.update({
      where: { id: teamCtx.teamId },
      data: { name, slug },
    });

    await writeAuditEvent({
      request: req,
      teamId: teamCtx.teamId,
      userId: teamCtx.userId,
      walletAddress: teamCtx.walletAddress,
      action: "team.update",
      resourceType: "Team",
      resourceId: team.id,
      beforeData: existing,
      afterData: { id: team.id, name: team.name, slug: team.slug },
    });

    return NextResponse.json({ id: team.id, name: team.name, slug: team.slug });
  } catch (err) {
    console.error("[api/team PUT]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
