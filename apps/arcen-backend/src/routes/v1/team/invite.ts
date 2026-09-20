import type { Context } from "hono";
import { z } from "zod";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../lib/auth/team-session.js";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";
import { teamInviteProtect, arcjetNodeRequest } from "../../../lib/auth/arcjet.js";
import { assertCanInviteMember } from "../../../lib/catalog/tier-guard.js";
import { createTeamInvitation, normalizeEmail } from "../../../lib/auth/auth-flow.js";

const InviteSchema = z.object({
  email: z.string().email(),
  role: z
    .enum(["ADMIN", "MEMBER", "FINANCE", "DEVELOPER", "SUPPORT"])
    .default("MEMBER"),
});

export async function inviteMember(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const team = await resolveTeamContext(session);
    if (!team) {
      return c.json({ ok: false, error: "No team found", code: "FORBIDDEN" }, 403 as any);
    }

    if (team.teamRole !== "OWNER" && team.teamRole !== "ADMIN") {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }

    const tierCheck = await assertCanInviteMember(team.teamId);
    if (!tierCheck.allowed) {
      return c.json({
          ok: false,
          error: "Team member limit reached",
          code: "FORBIDDEN",
          reason: tierCheck.reason,
          limit: tierCheck.limit,
          current: tierCheck.current,
          upgradeRequired: tierCheck.upgradeRequired,
        }, 403 as any);
    }

    const decision = await teamInviteProtect.protect(arcjetNodeRequest(c.req.raw) as any, { teamId: team.teamId });
    if (decision.isDenied()) {
      if (decision.reason.isBot()) {
        return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
      }
      return c.json({ ok: false, error: "Too many invitations sent. Please wait before sending more.", code: "RATE_LIMITED" }, 429 as any);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = InviteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({
          ok: false,
          error: "Invalid request",
          code: "BAD_REQUEST",
          details: parsed.error.flatten().fieldErrors,
        }, 400 as any);
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
        return c.json({ ok: false, error: "User is already a team member", code: "CONFLICT" }, 409 as any);
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
      return c.json({ ok: false, error: "An active invitation already exists for this email", code: "CONFLICT" }, 409 as any);
    }

    await createTeamInvitation({
      teamId: team.teamId,
      email,
      role: parsed.data.role,
      invitedByUserId: team.userId,
      inviterEmail: session.email,
    });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) ?? null },
      teamId: team.teamId,
      userId: team.userId,
      walletAddress: team.walletAddress,
      action: "team.invite",
      resourceType: "TeamMember",
      metadata: { email, role: parsed.data.role },
    });

    return c.json({ ok: true, email, role: parsed.data.role });
  } catch (err) {
    console.error("[api/team/invite POST]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}
