import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  // Step 2: Mandatory wallet setup.
  // If this account has NEVER linked a wallet, force them through the
  // one-time wallet setup before entering the dashboard.
  // Once linked, providers can access the dashboard from ANY device —
  // even without that wallet connected in the browser. On-chain operations
  // (plan registration) will require the primary wallet to be connected,
  // but the dashboard itself is device-agnostic.
  const user = await db.user.findUnique({
    where: { clerkUserId: userId },
    select: { walletAddress: true },
  });

  if (!user?.walletAddress) {
    redirect("/onboarding/wallet");
  }

  return <>{children}</>;
}
