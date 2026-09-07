import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, callBackend } from "@/lib/auth.server";
import { createPageMetadata } from "@/lib/seo";
import { isPlatformAdminEmail } from "@/lib/admin";

export const metadata: Metadata = createPageMetadata({
  title: "Dashboard",
  description:
    "Internal ArcenPay workspace dashboard for billing operations and analytics.",
  path: "/",
  noIndex: true,
});

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  if (!session.walletAddress && !session.stellarWalletAddress) {
    redirect("/onboarding/chain");
  }

  // 1. Activation Gate:
  // Brand new workspaces that have never activated must provide an activation key first.
  // Existing workspaces whose keys expired or were revoked are permitted into the
  // dashboard in Read-Only mode so they can view their historical billing data.
  const isPlatformAdmin = session.isPlatformAdmin || isPlatformAdminEmail(session.email);
  const isActivated = isPlatformAdmin || session.isPlatformActivated || session.currentTeam?.isPlatformActivated;
  const keyStatus = session.activationKeyStatus || session.currentTeam?.activationKeyStatus;
  const isExpiredOrRevoked = keyStatus === "EXPIRED" || keyStatus === "REVOKED";

  if (!isPlatformAdmin && !isActivated && !isExpiredOrRevoked) {
    redirect("/onboarding/activation");
  }

  // 2. Provider Profile Check (OWNER/ADMIN only):
  const isAdminRole = session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN";
  if (session.currentTeamId && isAdminRole) {
    const profileRes = await callBackend<{
      providerName?: string | null;
      legalName?: string | null;
    }>("/api/v1/provider/profile");
    const hasProfile = !!(profileRes?.providerName || profileRes?.legalName);
    if (profileRes && !hasProfile) {
      redirect("/onboarding/provider-profile");
    }
  }

  // 3. Environment Check:
  const hasEnvironment = !!session.activeEnvironment || session.environments.length > 0;
  if (!hasEnvironment) {
    if (session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN") {
      redirect("/onboarding/environment");
    }
    redirect("/onboarding/environment/waiting");
  }

  return <>{children}</>;
}
