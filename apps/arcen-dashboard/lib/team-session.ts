import { db } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth.server";
import type { TeamRole } from "@/lib/auth";

export type TeamContext = {
  teamId: string;
  teamRole: TeamRole;
  userId?: string;
  address?: string;
};

/** Resolves the current team and role from session, falling back to first membership. */
export async function resolveTeamContext(
  session: SessionPayload,
): Promise<TeamContext | null> {
  if (session.teamId) {
    return {
      teamId: session.teamId,
      teamRole: (session.teamRole || "MEMBER") as TeamRole,
      userId: "userId" in session ? session.userId : undefined,
      address: session.address,
    };
  }

  const userId = "userId" in session ? session.userId : undefined;
  if (!userId) return null;

  const membership = await db.teamMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { teamId: true, role: true },
  });

  if (!membership) return null;
  return {
    teamId: membership.teamId,
    teamRole: membership.role as TeamRole,
    userId,
    address: session.address,
  };
}
