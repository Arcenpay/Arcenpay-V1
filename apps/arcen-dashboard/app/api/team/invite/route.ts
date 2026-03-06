// ============================================================
//  Dashboard API — Invite Member by Email
//  POST /api/team/invite
//
//  Adds the invited user to the team and sends them a magic-link
//  email so they can sign in and access the workspace immediately.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";
import { sendTeamInviteEmail } from "@/lib/email";

const MAGIC_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (v) => v.toString(16).padStart(2, "0")).join("");
}

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.teamId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.teamRole !== "OWNER" && session.teamRole !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

    // Fetch team name for the email
    const team = await db.team.findUnique({
      where: { id: session.teamId },
      select: { name: true },
    });

    // Find or create the user by email
    let user = await db.user.findUnique({ where: { email } });
    if (!user) {
      user = await db.user.create({ data: { email } });
    }

    // Check if already a member
    const existing = await db.teamMember.findFirst({
      where: { teamId: session.teamId, userId: user.id },
    });
    if (existing) {
      return NextResponse.json(
        { error: "User is already a team member" },
        { status: 409 },
      );
    }

    // Add them to the team
    await db.teamMember.create({
      data: {
        teamId: session.teamId,
        userId: user.id,
        role,
      },
    });

    // Invalidate any existing unused magic tokens for this email
    await db.magicToken.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date(0) },
    });

    // Create a fresh magic token so the invite link signs them in directly
    const token = randomHex(32);
    await db.magicToken.create({
      data: {
        token,
        email,
        expiresAt: new Date(Date.now() + MAGIC_TOKEN_TTL_MS),
        userId: user.id,
      },
    });

    // Send invitation email — non-fatal so team membership is still created
    const inviterEmail =
      session.authMethod === "magic" ? session.email : session.email ?? null;
    try {
      await sendTeamInviteEmail(
        email,
        token,
        team?.name ?? "the team",
        inviterEmail ?? null,
      );
    } catch (emailErr) {
      console.error("[api/team/invite] Email send failed:", emailErr);
    }

    return NextResponse.json({ ok: true, email, role });
  } catch (err) {
    console.error("[api/team/invite POST]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
