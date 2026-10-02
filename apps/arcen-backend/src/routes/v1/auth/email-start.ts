import type { Context } from "hono";
import { z } from "zod";
import { authEmailStartProtect, arcjetNodeRequest } from "../../../lib/auth/arcjet.js";
import {
  EMAIL_AUTH_PURPOSE_LOGIN,
  EMAIL_AUTH_RESEND_COOLDOWN_MS,
  WALLET_ADDRESS_REGEX,
  findWalletConflict,
  findEmailWalletConflict,
  getLatestActiveEmailCode,
  getActiveTeamInvitationByToken,
  issueEmailAuthCode,
  normalizeEmail,
} from "../../../lib/auth/auth-flow.js";

const Schema = z.object({
  email: z.string().email(),
  walletAddress: z.string().regex(WALLET_ADDRESS_REGEX).optional(),
  inviteToken: z.string().min(1).optional(),
});

function buildRetryHeaders(retryAtIso: string): Record<string, string> {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(retryAtIso).getTime() - Date.now()) / 1000),
  );
  return {
    "retry-after": String(retryAfterSeconds),
  };
}

export async function startEmail(c: Context) {
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

  // Arcjet rate limit: 5 req/10min per IP
  const decision = await authEmailStartProtect.protect(arcjetNodeRequest(c.req.raw) as any);
  if (decision.isDenied()) {
    console.warn("[DEBUG-auth-20260907] email start denied", {
      reason: decision.reason.isBot() ? "bot" : "rate_limited",
    });
    if (decision.reason.isBot()) {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }
    return c.json({ ok: false, error: "Too many verification attempts. Please wait and try again.", code: "RATE_LIMITED" }, 429 as any);
  }

  // Set when this email already has a DIFFERENT wallet linked. The user is
  // legitimately adding another chain family's wallet to their existing
  // account, so we surface it (for the onboarding confirmation) rather than
  // hard-blocking. Proving the email code + signing with the new wallet is what
  // authorizes the link; the hard block is reserved for a wallet that already
  // belongs to a *different* account (checked above).
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
      existingAccountWallet = emailConflict.ownerWallet;
    }
  }

  if (parsed.data.inviteToken) {
    const invitation = await getActiveTeamInvitationByToken(parsed.data.inviteToken);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return c.json({ ok: false, error: "This invitation is no longer valid.", code: "NOT_FOUND" }, 404 as any);
    }
    if (normalizeEmail(invitation.email) !== email) {
      return c.json({ ok: false, error: "Use the invited email address to accept this workspace invite.", code: "CONFLICT" }, 409 as any);
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
    const retryHeaders = buildRetryHeaders(retryAt.toISOString());
    c.header("retry-after", retryHeaders["retry-after"]);
    return c.json({
        ok: false,
        error: "A code was just sent. Please wait a moment before requesting another one.",
        code: "RATE_LIMITED",
        retryAt: retryAt.toISOString(),
      }, 429 as any);
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
    return c.json({
        ok: false,
        error:
          issued && "error" in issued
            ? issued.error
            : "Could not send verification code.",
        code: "INTERNAL_ERROR",
      }, 500 as any);
  }

  return c.json({
    ok: true,
    expiresAt: issued.expiresAt.toISOString(),
    retryAt: issued.retryAt.toISOString(),
    // Present when the email already has an account with a different wallet —
    // the client uses this to confirm "you already have a workspace; link this
    // new wallet to it?" instead of treating the user as brand new.
    ...(existingAccountWallet
      ? { existingAccountWallet, existingAccount: true }
      : {}),
    ...(process.env.NODE_ENV !== "production" ? { debugCode: issued.code } : {}),
  });
}
