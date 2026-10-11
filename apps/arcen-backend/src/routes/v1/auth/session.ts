import type { Context } from "hono";
import { db } from "../../../db.js";
import { getSessionFromCtx, refreshSession } from "../../../lib/auth/auth.server.js";
import {
  findResolvedActiveEnvironment,
  listEnvironmentSummaries,
  toEnvironmentSummary,
} from "../../../lib/environments/workspace-environments.js";
import { isPlatformAdminEmail } from "../../../config.js";

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
          platformTier: true,
          isPlatformActivated: true,
          allowPlatformBilling: true,
          activationKeyId: true,
          activationKey: {
            select: {
              id: true,
              status: true,
              expiresAt: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const currentTeam =
    memberships.find((membership) => membership.teamId === session.currentTeamId) ??
    memberships[0] ??
    null;

  const isAdmin = isPlatformAdminEmail(session.email);
  let isTeamActivated = false;
  let keyStatus: "ACTIVE" | "EXPIRED" | "REVOKED" | "UNACTIVATED" = "UNACTIVATED";

  if (currentTeam?.team) {
    const key = currentTeam.team.activationKey;
    const isRevoked = key?.status === "REVOKED";
    const isExpired =
      key?.status === "EXPIRED" ||
      Boolean(key?.expiresAt && new Date(key.expiresAt) < new Date());
    isTeamActivated =
      Boolean(currentTeam.team.isPlatformActivated) &&
      !isRevoked &&
      !isExpired &&
      Boolean(currentTeam.team.activationKeyId);

    keyStatus = isRevoked
      ? "REVOKED"
      : isExpired
      ? "EXPIRED"
      : isTeamActivated
      ? "ACTIVE"
      : "UNACTIVATED";

    if (currentTeam.team.isPlatformActivated && !isTeamActivated && !isAdmin) {
      await db.team.update({
        where: { id: currentTeam.team.id },
        data: { isPlatformActivated: false },
      }).catch(() => {});
    }
  }

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
      stellarWalletAddress: session.stellarWalletAddress,
      solanaWalletAddress: session.solanaWalletAddress,
      isPlatformAdmin: isAdmin,
    },
    currentTeam: currentTeam
      ? {
          id: currentTeam.team.id,
          name: currentTeam.team.name,
          slug: currentTeam.team.slug,
          role: currentTeam.role,
          platformTier: currentTeam.team.platformTier,
          isPlatformActivated: isAdmin ? true : isTeamActivated,
          allowPlatformBilling: currentTeam.team.allowPlatformBilling,
          activationKeyId: currentTeam.team.activationKeyId,
          activationKeyStatus: isAdmin ? "ACTIVE" : keyStatus,
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
