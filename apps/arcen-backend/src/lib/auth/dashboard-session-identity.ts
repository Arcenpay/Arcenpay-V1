import { db } from "../../db.js";

export interface DashboardSessionIdentityDefaults {
  companyId: string | null;
  companyName: string | null;
  companyEmail: string | null;
  userId: string | null;
  clerkUserId: string;
  userName: string | null;
  userEmail: string | null;
  walletAddress: string | null;
}

function buildDisplayName(email: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0]?.trim();
  return local || email;
}

export async function resolveDashboardSessionIdentityDefaults(
  teamId: string,
  sessionUserId: string,
  environmentId?: string | null,
): Promise<DashboardSessionIdentityDefaults | null> {
  const [team, dbUser, arcenUser] = await Promise.all([
    db.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { id: sessionUserId },
      select: {
        id: true,
        walletAddress: true,
        email: true,
      },
    }),
    db.arcenUser.findFirst({
      where: {
        teamId,
        ...(environmentId ? { environmentId } : {}),
        OR: [{ id: sessionUserId }, { clerkUserId: sessionUserId }],
      },
      select: { id: true },
    }),
  ]);

  if (!team || !dbUser) return null;

  const primaryEmail = dbUser.email ?? null;
  const userName = buildDisplayName(primaryEmail);

  return {
    companyId: null,
    companyName: team.name ?? null,
    companyEmail: primaryEmail,
    userId: arcenUser?.id ?? null,
    clerkUserId: sessionUserId,
    userName,
    userEmail: primaryEmail,
    walletAddress: dbUser.walletAddress ?? null,
  };
}
