import type { Context } from "hono";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../lib/auth/team-session.js";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

export async function listInvites(c: Context) {
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

  const invitations = await db.teamInvitation.findMany({
    where: {
      teamId: team.teamId,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return c.json({
    invitations: invitations.map((invitation) => ({
      id: invitation.id,
      emailAddress: invitation.email,
      role: invitation.role,
      createdAt: invitation.createdAt,
      expiresAt: invitation.expiresAt,
    })),
  });
}

export async function revokeInvite(c: Context) {
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

  const url = new URL(c.req.url);
  const invitationId = url.searchParams.get("id");
  if (!invitationId) {
    return c.json({ ok: false, error: "Missing invitation id", code: "BAD_REQUEST" }, 400 as any);
  }

  const invitation = await db.teamInvitation.findFirst({
    where: { id: invitationId, teamId: team.teamId },
    select: { id: true },
  });

  if (!invitation) {
    return c.json({ ok: false, error: "Invitation not found", code: "NOT_FOUND" }, 404 as any);
  }

  await db.teamInvitation.update({
    where: { id: invitation.id },
    data: { revokedAt: new Date() },
  });

  await writeAuditEvent({
    headers: { get: (name: string) => c.req.header(name) ?? null },
    teamId: team.teamId,
    userId: team.userId,
    walletAddress: team.walletAddress,
    action: "team.invite.revoke",
    resourceType: "TeamInvitation",
    resourceId: invitation.id,
    metadata: { invitationId: invitation.id },
  });

  return c.json({ ok: true, invitationId: invitation.id });
}
