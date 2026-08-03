import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, callBackend } from "@/lib/auth.server";
import { createPageMetadata } from "@/lib/seo";

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

  if (!session.walletAddress) {
    redirect("/onboarding/chain");
  }

  // Check if provider profile exists (OWNER/ADMIN only — others skip)
  const isAdmin = session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN";
  if (session.currentTeamId && isAdmin) {
    const profileRes = await callBackend<{
      providerName?: string | null;
      contactEmail?: string | null;
      legalName?: string | null;
    }>("/api/v1/provider/profile");
    // `callBackend` returns null when the backend is temporarily unavailable.
    // Treating that transport failure as an empty profile sends completed
    // workspaces back into onboarding. Only an explicit profile response can
    // prove that onboarding is incomplete.
    // Signup creates a contact-email placeholder so billing can identify the
    // workspace. That placeholder is not completed provider onboarding.
    const hasProfile = !!(profileRes?.providerName || profileRes?.legalName);
    if (profileRes && !hasProfile) {
      redirect("/onboarding/provider-profile");
    }
  }

  // The session endpoint normally resolves the first environment and repairs
  // stale session state. Keep the layout resilient if the session response
  // contains the environment list but not its active pointer yet.
  const hasEnvironment = !!session.activeEnvironment || session.environments.length > 0;
  if (!hasEnvironment) {
    if (session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN") {
      redirect("/onboarding/environment");
    }
    redirect("/onboarding/environment/waiting");
  }

  return <>{children}</>;
}
