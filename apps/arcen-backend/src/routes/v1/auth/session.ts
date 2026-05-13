import type { Context } from "hono";
import { randomBytes } from "node:crypto";
import { setCookie, getCookie } from "hono/cookie";
import { db } from "../../../db.js";
import { getSessionFromCtx, refreshSession, createSession as createDbSession } from "../../../lib/auth/auth.server.js";
import {
  findResolvedActiveEnvironment,
  listEnvironmentSummaries,
  toEnvironmentSummary,
} from "../../../lib/environments/workspace-environments.js";

export async function getSession(c: Context) {
  const session = await getSessionFromCtx(c);
  if (!session) {
    return c.json({ ok: false, error: "Unauthorized", code: "UNAUTHORIZED" }, 401 as any);
  }

  await refreshSession(c, session.sessionId);

  const memberships = await db.teamMember.findMany({
    where: { userId: session.userId },
    include: {
      team: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const currentTeam =
    memberships.find((membership) => membership.teamId === session.currentTeamId) ??
    memberships[0] ??
    null;

  const activeEnvironment = currentTeam
    ? await findResolvedActiveEnvironment(session, currentTeam.team.id)
    : null;
  const environments = currentTeam
    ? await listEnvironmentSummaries(currentTeam.team.id, activeEnvironment?.id ?? session.activeEnvironmentId)
    : [];

  return c.json({
    user: {
      id: session.userId,
      email: session.email,
      walletAddress: session.walletAddress,
    },
    currentTeam: currentTeam
      ? {
          id: currentTeam.team.id,
          name: currentTeam.team.name,
          slug: currentTeam.team.slug,
          role: currentTeam.role,
        }
      : null,
    activeEnvironment: activeEnvironment
      ? toEnvironmentSummary(activeEnvironment, activeEnvironment.id)
      : null,
    environments,
    teams: memberships.map((membership) => ({
      id: membership.team.id,
      name: membership.team.name,
      slug: membership.team.slug,
      role: membership.role,
    })),
  });
}

export async function createSession(c: Context) {
  const body = await c.req.json() .catch(() => ({}));
  const { userId } = body as { userId?: string };

  if (!userId) {
    return c.json({ ok: false, error: "userId is required", code: "BAD_REQUEST" }, 400 as any);
  }

  const session = await createDbSession(c, userId);
  return c.json({
    sessionId: session.sessionId,
    userId: session.userId,
    email: session.email,
    walletAddress: session.walletAddress,
    currentTeamId: session.currentTeamId,
    expiresAt: session.expiresAt.toISOString(),
  });
}
