import type { Context } from "hono";
import { z } from "zod";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import {
  acceptTeamInvitation,
  getActiveTeamInvitationByToken,
  normalizeEmail,
} from "../../../lib/auth/auth-flow.js";
import { db } from "../../../db.js";

const Schema = z.object({
  token: z.string().min(1),
});

export async function acceptInvite(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
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

    const { token } = parsed.data;

    const invitation = await getActiveTeamInvitationByToken(token);
    if (!invitation || invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      return c.json({ ok: false, error: "This invitation is no longer valid or has expired.", code: "NOT_FOUND" }, 404 as any);
    }

    if (!session.email) {
      return c.json({ ok: false, error: "Your account does not have an email address. Please add an email to accept invitations.", code: "BAD_REQUEST" }, 400 as any);
    }

    if (normalizeEmail(session.email) !== normalizeEmail(invitation.email)) {
      return c.json({
          ok: false,
          error: "This invitation was sent to a different email address.",
          code: "CONFLICT",
          invitedEmail: invitation.email,
          currentEmail: session.email,
        }, 409 as any);
    }

    const result = await acceptTeamInvitation(session.userId, token);

    if (!result.ok) {
      const message =
        result.reason === "email_mismatch"
          ? "This invitation was sent to a different email address."
          : result.reason === "expired"
            ? "This invitation has expired."
            : "This invitation is no longer available.";
      return c.json({ ok: false, error: message, code: "BAD_REQUEST" }, 400 as any);
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { walletAddress: true },
    });

    return c.json({
      ok: true,
      teamId: result.invitation.team.id,
      teamName: result.invitation.team.name,
      teamSlug: result.invitation.team.slug,
      needsWallet: !user?.walletAddress,
    });
  } catch (err) {
    console.error("[api/team/invite/accept POST]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}
