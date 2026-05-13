import type { Context } from "hono";
import { z } from "zod";
import { getSessionFromCtx } from "../../../lib/auth/auth.server.js";
import { db } from "../../../db.js";

const Schema = z.object({
  teamId: z.string().min(1),
});

export async function switchTeam(c: Context) {
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

  const membership = await db.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: session.userId,
        teamId: parsed.data.teamId,
      },
    },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
  });

  if (!membership) {
    return c.json({ ok: false, error: "Team not found", code: "NOT_FOUND" }, 404 as any);
  }

  await db.user.update({
    where: { id: session.userId },
    data: { currentTeamId: parsed.data.teamId },
  });

  const firstEnvironment = await db.workspaceEnvironment.findFirst({
    where: { teamId: parsed.data.teamId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  await db.authSession.update({
    where: { id: session.sessionId },
    data: { activeEnvironmentId: firstEnvironment?.id ?? null },
  });

  return c.json({
    ok: true,
    currentTeam: {
      id: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug,
      role: membership.role,
    },
  });
}
