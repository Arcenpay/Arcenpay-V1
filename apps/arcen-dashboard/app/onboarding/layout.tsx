import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

/**
 * Guards the /onboarding/* group:
 * - Unauthenticated users are sent to /sign-in (redundant with middleware but
 *   provides a server-side hard stop before any DB call).
 * - Users who have already completed wallet onboarding are sent back to the
 *   dashboard so they cannot re-link a different wallet by navigating directly
 *   to /onboarding/wallet.
 */
export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { walletAddress: true },
  });

  // Already completed onboarding — skip back to dashboard
  if (user?.walletAddress) redirect("/");

  return <>{children}</>;
}
