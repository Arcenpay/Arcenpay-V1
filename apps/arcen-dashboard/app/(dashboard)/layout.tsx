import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import AutoRefresh from "@/components/auto-refresh";

/**
 * Dashboard layout — three sequential guards:
 *
 * 1. Clerk session: unauthenticated → /sign-in
 * 2. Wallet linked: no wallet on DB record → /onboarding/wallet
 * 3. Workspace ready: no team membership yet (webhook still in-flight from
 *    Clerk's auto-org creation) → inline "pending" screen that auto-refreshes
 *    until the team is available.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      walletAddress: true,
      teams: { take: 1, select: { teamId: true } },
    },
  });

  if (!user?.walletAddress) {
    redirect("/onboarding/wallet");
  }

  // Workspace not synced from Clerk webhook yet — show a pending UI.
  // This is a transient state that resolves in a few seconds once
  // organization.created + organizationMembership.created webhooks fire.
  if (user.teams.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">
            Setting up your workspace…
          </h2>
          <p className="text-sm text-muted-foreground">
            Your workspace is being created. This takes just a moment.
          </p>
          {/* Reload every 2 s until the webhook has synced the team */}
          <AutoRefresh intervalMs={2000} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
