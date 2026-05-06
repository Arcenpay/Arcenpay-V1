import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authEmailStartProtect } from "@/lib/arcjet";
import {
  EMAIL_AUTH_PURPOSE_LOGIN,
  EMAIL_AUTH_RESEND_COOLDOWN_MS,
  findWalletConflict,
  getLatestActiveEmailCode,
  getActiveTeamInvitationByToken,
  issueEmailAuthCode,
  normalizeEmail,
} from "@/lib/auth-flow";

const Schema = z.object({
  email: z.string().email(),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  inviteToken: z.string().min(1).optional(),
});

function buildRetryHeaders(retryAtIso: string): HeadersInit {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(retryAtIso).getTime() - Date.now()) / 1000),
  );
  return {
    "retry-after": String(retryAfterSeconds),
  };
}

export async function POST(request: NextRequest) {
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

  // Arcjet rate limit: 5 req/10min per IP + per email
  const decision = await authEmailStartProtect.protect(request, { email });
  if (decision.isDenied()) {
    if (decision.reason.isBot()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Too many verification attempts. Please wait and try again." },
      { status: 429 },
    );
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

  // Resend cooldown (separate from rate limiting — prevents immediate re-send of same code)
  const latestActive = await getLatestActiveEmailCode(email, EMAIL_AUTH_PURPOSE_LOGIN);
  if (
    latestActive &&
    Date.now() - latestActive.createdAt.getTime() < EMAIL_AUTH_RESEND_COOLDOWN_MS
  ) {
    const retryAt = new Date(
      latestActive.createdAt.getTime() + EMAIL_AUTH_RESEND_COOLDOWN_MS,
    );
    return NextResponse.json(
      {
        error: "A code was just sent. Please wait a moment before requesting another one.",
        retryAt: retryAt.toISOString(),
      },
      {
        status: 429,
        headers: buildRetryHeaders(retryAt.toISOString()),
      },
    );
  }

  const issued = await issueEmailAuthCode({
    email,
    purpose: EMAIL_AUTH_PURPOSE_LOGIN,
  }).catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Could not send verification code.";
    console.error("[api/auth/email/start]", error);
    return { error: message } as const;
  });

  if (!issued || "error" in issued) {
    return NextResponse.json(
      {
        error:
          issued && "error" in issued
            ? issued.error
            : "Could not send verification code.",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    expiresAt: issued.expiresAt.toISOString(),
    retryAt: issued.retryAt.toISOString(),
    ...(process.env.NODE_ENV !== "production" ? { debugCode: issued.code } : {}),
  });
}
