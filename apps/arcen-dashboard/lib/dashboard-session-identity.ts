import { currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";

export interface DashboardSessionIdentityDefaults {
  companyId: string;
  companyName: string | null;
  companyEmail: string | null;
  userId: string;
  clerkUserId: string;
  userName: string | null;
  userEmail: string | null;
  walletAddress: string | null;
}

function buildDisplayName(input: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fallback?: string | null;
}): string | null {
  if (input.fullName?.trim()) return input.fullName.trim();
  const joined = [input.firstName, input.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  if (joined) return joined;
  return input.fallback?.trim() || null;
}

export async function resolveDashboardSessionIdentityDefaults(
  teamId: string,
  clerkUserId: string,
): Promise<DashboardSessionIdentityDefaults | null> {
  const [team, dbUser, clerkUser] = await Promise.all([
    db.team.findUnique({
      where: { id: teamId },
      select: { id: true, name: true },
    }),
    db.user.findUnique({
      where: { clerkUserId },
      select: {
        id: true,
        walletAddress: true,
        email: true,
      },
    }),
    currentUser(),
  ]);

  if (!team) return null;

  const primaryEmail =
    clerkUser?.emailAddresses?.[0]?.emailAddress ?? dbUser?.email ?? null;
  const userName = buildDisplayName({
    fullName: clerkUser?.fullName,
    firstName: clerkUser?.firstName,
    lastName: clerkUser?.lastName,
    fallback: primaryEmail ?? null,
  });

  return {
    companyId: team.id,
    companyName: team.name ?? null,
    companyEmail: primaryEmail,
    userId: clerkUserId,
    clerkUserId,
    userName,
    userEmail: primaryEmail,
    walletAddress: dbUser?.walletAddress ?? null,
  };
}
