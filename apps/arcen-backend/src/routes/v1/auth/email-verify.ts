import type { Context } from "hono";
import { z } from "zod";
import { authEmailVerifyProtect, arcjetNodeRequest } from "../../../lib/auth/arcjet.js";
import {
  EMAIL_AUTH_MAX_ATTEMPTS,
  EMAIL_AUTH_PURPOSE_LOGIN,
  WALLET_ADDRESS_REGEX,
  acceptTeamInvitation,
  findWalletConflict,
  findEmailWalletConflict,
  getActiveTeamInvitationByToken,
  normalizeEmail,
  provisionUserForEmail,
  verifyEmailAuthCode,
} from "../../../lib/auth/auth-flow.js";
import { createSession } from "../../../lib/auth/auth.server.js";
import { db } from "../../../db.js";

const Schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
  walletAddress: z.string().regex(WALLET_ADDRESS_REGEX).optional(),
  inviteToken: z.string().min(1).optional(),
});

export async function verifyEmail(c: Context) {
  const decision = await authEmailVerifyProtect.protect(arcjetNodeRequest(c.req.raw) as any);
  if (decision.isDenied()) {
    if (decision.reason.isBot()) {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }
    return c.json({ ok: false, error: "Too many requests", code: "RATE_LIMITED" }, 429 as any);
  }

  const body = await c.req.json() .catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return c.json({
        ok: false,
        error: "Invalid request",
        code: "BAD_REQUEST",
        details: parsed.error.flatten().fieldErrors,
      }, 400 as any);
  }

  const email = normalizeEmail(parsed.data.email);
  if (parsed.data.inviteToken) {
    const invitation = await getActiveTeamInvitationByToken(parsed.data.inviteToken);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return c.json({ ok: false, error: "This invitation is no longer valid.", code: "NOT_FOUND" }, 404 as any);
    }
    if (normalizeEmail(invitation.email) !== email) {
      return c.json({ ok: false, error: "Use the invited email address to accept this workspace invite.", code: "CONFLICT" }, 409 as any);
    }
  }

  const verification = await verifyEmailAuthCode({
    email,
    code: parsed.data.code,
    purpose: EMAIL_AUTH_PURPOSE_LOGIN,
  });

  if (!verification.ok) {
    if (verification.reason === "too_many_attempts") {
      return c.json({
          ok: false,
          error: `Too many incorrect codes. Please request a new code after ${EMAIL_AUTH_MAX_ATTEMPTS} attempts.`,
          code: "RATE_LIMITED",
        }, 429 as any);
    }

    const message =
      verification.reason === "missing"
        ? "Verification code expired. Request a new code to continue."
        : "Incorrect verification code.";

    return c.json({ ok: false, error: message, code: "UNAUTHORIZED" }, 401 as any);
  }

  // Set when this email already has a DIFFERENT wallet linked (the user is
  // adding another chain family's wallet to their existing account).
  let existingAccountWallet: string | null = null;

  if (parsed.data.walletAddress) {
    const conflict = await findWalletConflict(parsed.data.walletAddress, email);
    if (conflict.conflict) {
      return c.json({
          ok: false,
          error: "This wallet is already linked to another account. Please sign in with the email registered for that wallet.",
          code: "CONFLICT",
          maskedOwnerEmail: conflict.maskedEmail,
        }, 409 as any);
    }

    const emailConflict = await findEmailWalletConflict(email, parsed.data.walletAddress);
    if (emailConflict.conflict) {
      // Informational only — the user is adding another chain family's wallet
      // to their existing account. Linking still requires this verified email
      // code plus a wallet signature below.
      existingAccountWallet = emailConflict.ownerWallet;
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
      stellarWalletAddress: true,
      solanaWalletAddress: true,
    },
  });

  await createSession(c, refreshedUser.id);
  const hasAnyWallet = Boolean(
    refreshedUser.walletAddress ||
    refreshedUser.stellarWalletAddress ||
    refreshedUser.solanaWalletAddress,
  );
  console.info("[DEBUG-auth-20260907] email verified and session issued", {
    hasWallet: hasAnyWallet,
  });

  return c.json({
    ok: true,
    inviteAccepted,
    inviteError,
    // Present when the email already had a different wallet linked — the
    // onboarding UI confirms before adding the new one.
    ...(existingAccountWallet
      ? { existingAccountWallet, existingAccount: true }
      : {}),
    redirectTo: hasAnyWallet ? "/" : "/onboarding/wallet",
  });
}
