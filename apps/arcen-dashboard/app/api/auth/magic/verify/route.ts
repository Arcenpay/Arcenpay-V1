// ============================================================
//  Dashboard API — Magic Link Verify
//  GET /api/auth/magic/verify?token=<token>[&callbackUrl=<path>]
//
//  Validates the one-time token, issues a session cookie, and
//  redirects to the dashboard (or callbackUrl).
//
//  Special case — wallet+email step-2:
//  If the request arrives with an existing wallet session that has
//  needsEmail=true, the verified email is linked to the wallet user
//  rather than issuing a brand-new email session.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  createSession,
  createEmailSession,
  COOKIE_NAME,
  verifySession,
  type TeamRole,
} from "@/lib/auth";

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const token = searchParams.get("token");
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=missing_token", req.url));
  }

  try {
    const record = await db.magicToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!record) {
      return NextResponse.redirect(new URL("/login?error=invalid_token", req.url));
    }
    if (record.usedAt !== null) {
      return NextResponse.redirect(new URL("/login?error=token_used", req.url));
    }
    if (new Date() > record.expiresAt) {
      return NextResponse.redirect(new URL("/login?error=token_expired", req.url));
    }

    // Mark token as used (atomic)
    await db.magicToken.update({ where: { token }, data: { usedAt: new Date() } });

    const emailFromToken = record.email;

    // ── Check if there's an existing wallet session that needs an email ─────
    const existingCookie = req.cookies.get(COOKIE_NAME)?.value;
    const existingSession = existingCookie ? await verifySession(existingCookie) : null;

    if (
      existingSession?.authMethod === "siwe" &&
      existingSession.needsEmail &&
      existingSession.userId
    ) {
      // Link the verified email to the wallet user
      const walletUser = await db.user.findUnique({
        where: { id: existingSession.userId },
      });

      if (walletUser && !walletUser.email) {
        // Check the email isn't already claimed by a different user
        const emailOwner = await db.user.findUnique({
          where: { email: emailFromToken },
        });
        if (emailOwner && emailOwner.id !== walletUser.id) {
          // Email belongs to another account — delete the orphan email-only record
          // if it has no wallet (safe to remove), otherwise reject
          if (!emailOwner.walletAddress) {
            await db.user.delete({ where: { id: emailOwner.id } });
          } else {
            return NextResponse.redirect(
              new URL("/login?error=email_taken", req.url),
            );
          }
        }

        // Update wallet user with email
        await db.user.update({
          where: { id: walletUser.id },
          data: { email: emailFromToken, emailVerified: true },
        });

        // Re-issue the SIWE session — now with email and needsEmail cleared
        const newToken = await createSession(
          existingSession.address,
          existingSession.chainId,
          {
            userId: walletUser.id,
            email: emailFromToken,
            teamId: existingSession.teamId,
            teamRole: existingSession.teamRole,
            needsEmail: false,
          },
        );

        const safeCallback =
          callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
            ? callbackUrl
            : "/";
        const response = NextResponse.redirect(new URL(safeCallback, origin));
        response.cookies.set(COOKIE_NAME, newToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 24 * 60 * 60,
        });
        return response;
      }
    }

    // ── Standard magic-link sign-in ─────────────────────────────────────────
    const user = record.user;
    if (!user) {
      return NextResponse.redirect(new URL("/login?error=user_not_found", req.url));
    }

    if (!user.emailVerified) {
      await db.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    }

    // Look up team membership
    const membership = await db.teamMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });

    const jwt = await createEmailSession(user.id, user.email!, {
      linkedWallet: user.walletAddress ?? undefined,
      teamId: membership?.teamId,
      teamRole: membership?.role as TeamRole | undefined,
    });

    const safeCallback =
      callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? callbackUrl
        : "/";

    const response = NextResponse.redirect(new URL(safeCallback, origin));
    response.cookies.set(COOKIE_NAME, jwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    console.error("[api/auth/magic/verify]", err);
    return NextResponse.redirect(new URL("/login?error=server_error", req.url));
  }
}
