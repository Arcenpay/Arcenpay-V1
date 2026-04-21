// ============================================================
//  Dashboard API — Invite Member by Email
//  POST /api/team/invite
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { rateLimit, applyRateLimitHeaders } from "@/lib/rate-limit";
import { assertCanInviteMember } from "@/lib/tier-guard";
import { createTeamInvitation, normalizeEmail } from "@/lib/auth-flow";

const INVITE_LIMIT = 5;
const INVITE_WINDOW_MS = 60 * 60 * 1000;

const InviteSchema = z.object({
  email: z.string().email(),
  role: z
    .enum(["ADMIN", "MEMBER", "FINANCE", "DEVELOPER", "SUPPORT"])
    .default("MEMBER"),
});

export async function POST(req: NextRequest) {
  try {
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

    const tierCheck = await assertCanInviteMember(team.teamId);
    if (!tierCheck.allowed) {
      return NextResponse.json(
        {
          error: "Team member limit reached",
          reason: tierCheck.reason,
          limit: tierCheck.limit,
          current: tierCheck.current,
          upgradeRequired: tierCheck.upgradeRequired,
        },
        { status: 403 },
      );
    }

    const rl = rateLimit(`invite:${team.teamId}`, INVITE_LIMIT, INVITE_WINDOW_MS);
    if (!rl.ok) {
      const res = NextResponse.json(
        { error: "Too many invitations sent. Please wait before sending more." },
        { status: 429 },
      );
      applyRateLimitHeaders(res.headers, rl, INVITE_LIMIT);
      return res;
    }

    const body = await req.json();
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }

    const email = normalizeEmail(parsed.data.email);

    const existingUser = await db.user.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const existingMember = await db.teamMember.findFirst({
        where: { teamId: team.teamId, userId: existingUser.id },
      });
      if (existingMember) {
        return NextResponse.json(
          { error: "User is already a team member" },
          { status: 409 },
        );
      }
    }

    const pendingInvite = await db.teamInvitation.findFirst({
      where: {
        teamId: team.teamId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pendingInvite) {
      return NextResponse.json(
        { error: "An active invitation already exists for this email" },
        { status: 409 },
      );
    }

    await createTeamInvitation({
      teamId: team.teamId,
      email,
      role: parsed.data.role,
      invitedByUserId: team.userId,
      inviterEmail: session.email,
    });

    await writeAuditEvent({
      request: req,
      teamId: team.teamId,
      userId: team.userId,
      walletAddress: team.walletAddress,
      action: "team.invite",
      resourceType: "TeamMember",
      metadata: { email, role: parsed.data.role },
    });

    return NextResponse.json({ ok: true, email, role: parsed.data.role });
  } catch (err) {
    console.error("[api/team/invite POST]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
