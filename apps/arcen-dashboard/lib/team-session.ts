import { db } from "@/lib/db";
import type { ClerkSession } from "@/lib/auth.server";
import type { TeamRole } from "@/lib/auth";

export type TeamContext = {
  teamId: string;
  teamRole: TeamRole;
  userId: string; // DB User.id (not clerkUserId)
  walletAddress?: string;
};

/** Resolves the current team and role from a Clerk session. */
export async function resolveTeamContext(
  session: ClerkSession,
): Promise<TeamContext | null> {
  // Look up the DB User for this Clerk identity
  const user = await db.user.findUnique({
    where: { clerkUserId: session.clerkUserId },
    select: { id: true, walletAddress: true, currentTeamId: true },
  });
  if (!user) return null;

  // If Clerk reports an active org, find team by clerkOrgId first
  if (session.orgId) {
    const team = await db.team.findUnique({
      where: { clerkOrgId: session.orgId },
      select: { id: true },
    });
    if (team) {
      const member = await db.teamMember.findUnique({
        where: { userId_teamId: { userId: user.id, teamId: team.id } },
        select: { role: true },
      });
      if (member) {
        return {
          teamId: team.id,
          teamRole: member.role as TeamRole,
          userId: user.id,
          walletAddress: user.walletAddress ?? undefined,
        };
      }
    }
  }

  // Fallback: use currentTeamId or first membership
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
