import type { Context } from "hono";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { resolveTeamContext } from "../../../lib/auth/team-session.js";
import { db } from "../../../db.js";
import { writeAuditEvent } from "../../../lib/platform/audit.js";

export async function removeMember(c: Context) {
  try {
    const session = await getSessionFromCtx(c);
    if (!session) {
      return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
    }

    const teamCtx = await resolveTeamContext(session);
    if (!teamCtx) {
      return c.json({ ok: false, error: "No team found", code: "FORBIDDEN" }, 403 as any);
    }

    if (teamCtx.teamRole !== "OWNER" && teamCtx.teamRole !== "ADMIN") {
      return c.json({ ok: false, error: "Forbidden", code: "FORBIDDEN" }, 403 as any);
    }

    const url = new URL(c.req.url);
    const userId = url.searchParams.get("userId");
    if (!userId) {
      return c.json({ ok: false, error: "userId query param required", code: "BAD_REQUEST" }, 400 as any);
    }

    // Can't remove the team owner
    const member = await db.teamMember.findFirst({
      where: { teamId: teamCtx.teamId, userId },
    });

    if (!member) {
      return c.json({ ok: false, error: "Member not found", code: "NOT_FOUND" }, 404 as any);
    }

    if (member.role === "OWNER") {
      return c.json({ ok: false, error: "Cannot remove the team owner", code: "BAD_REQUEST" }, 400 as any);
    }

    await db.teamMember.delete({ where: { id: member.id } });

    await writeAuditEvent({
      headers: { get: (name: string) => c.req.header(name) ?? null },
      teamId: teamCtx.teamId,
      userId: teamCtx.userId,
      walletAddress: teamCtx.walletAddress,
      action: "team.member.remove",
      resourceType: "TeamMember",
      resourceId: member.id,
      metadata: { userId },
    });

    return c.json({ ok: true });
  } catch (err) {
    console.error("[api/team/members DELETE]", err);
    return c.json({ ok: false, error: "Internal server error", code: "INTERNAL_ERROR" }, 500 as any);
  }
}
