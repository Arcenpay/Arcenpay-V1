import { db } from "../../db.js";
import type { ClerkSession } from "./auth.server.js";
import type { TeamRole } from "./auth.js";

export type TeamContext = {
  teamId: string;
  teamRole: TeamRole;
  userId: string; // DB User.id (not clerkUserId)
  walletAddress?: string;
};

/** Resolves the current team and role from a dashboard session. */
export async function resolveTeamContext(
  session: ClerkSession,
): Promise<TeamContext | null> {
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, walletAddress: true, currentTeamId: true },
  });
  if (!user) return null;

  const targetTeamId = user.currentTeamId ?? undefined;
  const membership = await db.teamMember.findFirst({
    where: {
      userId: user.id,
      ...(targetTeamId ? { teamId: targetTeamId } : {}),
    },
    orderBy: { createdAt: "asc" },
    select: { teamId: true, role: true },
  });

  if (!membership) return null;
  return {
    teamId: membership.teamId,
    teamRole: membership.role as TeamRole,
    userId: user.id,
    walletAddress: user.walletAddress ?? undefined,
  };
}
