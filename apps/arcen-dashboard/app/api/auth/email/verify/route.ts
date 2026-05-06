import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authEmailVerifyProtect } from "@/lib/arcjet";
import {
  EMAIL_AUTH_MAX_ATTEMPTS,
  EMAIL_AUTH_PURPOSE_LOGIN,
  acceptTeamInvitation,
  findWalletConflict,
  getActiveTeamInvitationByToken,
  normalizeEmail,
  provisionUserForEmail,
  verifyEmailAuthCode,
} from "@/lib/auth-flow";
import { createSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

const Schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  inviteToken: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const decision = await authEmailVerifyProtect.protect(request);
  if (decision.isDenied()) {
    if (decision.reason.isBot()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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

  const email = normalizeEmail(parsed.data.email);
  if (parsed.data.inviteToken) {
    const invitation = await getActiveTeamInvitationByToken(parsed.data.inviteToken);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return NextResponse.json({ error: "This invitation is no longer valid." }, { status: 404 });
    }
    if (normalizeEmail(invitation.email) !== email) {
      return NextResponse.json(
        { error: "Use the invited email address to accept this workspace invite." },
        { status: 409 },
      );
    }
  }

  const verification = await verifyEmailAuthCode({
    email,
    code: parsed.data.code,
    purpose: EMAIL_AUTH_PURPOSE_LOGIN,
  });

  if (!verification.ok) {
    if (verification.reason === "too_many_attempts") {
      return NextResponse.json(
        {
          error: `Too many incorrect codes. Please request a new code after ${EMAIL_AUTH_MAX_ATTEMPTS} attempts.`,
        },
        { status: 429 },
      );
    }

    const message =
      verification.reason === "missing"
        ? "Verification code expired. Request a new code to continue."
        : "Incorrect verification code.";

    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (parsed.data.walletAddress) {
    const conflict = await findWalletConflict(parsed.data.walletAddress, email);
    if (conflict.conflict) {
      return NextResponse.json(
        {
          error: "This wallet is already linked to another account. Please sign in with the email registered for that wallet.",
          maskedOwnerEmail: conflict.maskedEmail,
        },
        { status: 409 },
      );
    }
  }

  const user = await provisionUserForEmail(email);
  let inviteAccepted = false;
  let inviteError: string | null = null;

  if (parsed.data.inviteToken) {
    const inviteResult = await acceptTeamInvitation(user.id, parsed.data.inviteToken);
    if (inviteResult.ok) {
      inviteAccepted = true;
    } else if (inviteResult.reason === "email_mismatch") {
      inviteError = "This invite belongs to a different email address.";
    } else {
      inviteError = "This invite is no longer available.";
    }
  }

  const refreshedUser = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: {
      id: true,
      walletAddress: true,
    },
  });

  await createSession(refreshedUser.id);

  return NextResponse.json({
    ok: true,
    inviteAccepted,
    inviteError,
    redirectTo: refreshedUser.walletAddress ? "/" : "/onboarding/wallet",
  });
}
