import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth.server";
import {
  acceptTeamInvitation,
  getActiveTeamInvitationByToken,
  normalizeEmail,
} from "@/lib/auth-flow";
import { db } from "@/lib/db";

const Schema = z.object({
  token: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
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

    const { token } = parsed.data;

    const invitation = await getActiveTeamInvitationByToken(token);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json(
        { error: "This invitation is no longer valid or has expired." },
        { status: 404 },
      );
    }

    if (!session.email) {
      return NextResponse.json(
        { error: "Your account does not have an email address. Please add an email to accept invitations." },
        { status: 400 },
      );
    }

    if (normalizeEmail(session.email) !== normalizeEmail(invitation.email)) {
      return NextResponse.json(
        {
          error: "This invitation was sent to a different email address.",
          invitedEmail: invitation.email,
          currentEmail: session.email,
        },
        { status: 409 },
      );
    }

    const result = await acceptTeamInvitation(session.userId, token);

    if (!result.ok) {
      const message =
        result.reason === "email_mismatch"
          ? "This invitation was sent to a different email address."
          : result.reason === "expired"
            ? "This invitation has expired."
            : "This invitation is no longer available.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { walletAddress: true },
    });

    return NextResponse.json({
      ok: true,
      teamId: result.invitation.team.id,
      teamName: result.invitation.team.name,
      teamSlug: result.invitation.team.slug,
      needsWallet: !user?.walletAddress,
    });
  } catch (err) {
    console.error("[api/team/invite/accept POST]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}