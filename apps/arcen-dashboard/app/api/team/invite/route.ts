// ============================================================
//  Dashboard API — Invite Member by Email
//  POST /api/team/invite
//
//  Sends a Clerk Organization invitation. The webhook
//  (organizationMembership.created) will create the DB TeamMember
//  when the invitee accepts.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clerkClient } from "@clerk/nextjs/server";
import { getSession } from "@/lib/auth.server";
import { resolveTeamContext } from "@/lib/team-session";
import { db } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import { rateLimit, applyRateLimitHeaders } from "@/lib/rate-limit";
import { assertCanInviteMember } from "@/lib/tier-guard";

// 5 invites per team per hour — prevents invite spam
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

    // ── Tier limit enforcement ──────────────────────────────────────────────
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

    const { email, role } = parsed.data;

    // Get team record to find Clerk org ID
    const dbTeam = await db.team.findUnique({
      where: { id: team.teamId },
      select: { name: true, clerkOrgId: true },
    });

    if (!dbTeam?.clerkOrgId) {
      return NextResponse.json(
        {
          error:
            "Team is not linked to a Clerk organization. Please contact support.",
        },
        { status: 400 },
      );
    }

    // Check if user is already a member
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

    // Send Clerk org invitation — Clerk sends the invite email automatically.
    // The `dbRole` on publicMetadata is read by the webhook handler to set
    // the correct fine-grained role when the invite is accepted.
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: dbTeam.clerkOrgId,
      emailAddress: email,
      role: "org:member",
      inviterUserId: session.clerkUserId,
      publicMetadata: { dbRole: role },
    });

    await writeAuditEvent({
      request: req,
      teamId: team.teamId,
      userId: team.userId,
      walletAddress: team.walletAddress,
      action: "team.invite",
      resourceType: "TeamMember",
      metadata: { email, role },
    });

    return NextResponse.json({ ok: true, email, role });
  } catch (err) {
    console.error("[api/team/invite POST]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
