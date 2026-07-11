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
    redirect("/onboarding/wallet");
  }

  // Check if provider profile exists (OWNER/ADMIN only — others skip)
  const isAdmin = session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN";
  if (session.currentTeamId && isAdmin) {
    const profileRes = await callBackend<{
      providerName?: string | null;
      contactEmail?: string | null;
      legalName?: string | null;
    }>("/api/v1/provider/profile");
    const hasProfile = !!(profileRes?.providerName || profileRes?.contactEmail || profileRes?.legalName);
    if (!hasProfile) {
      redirect("/onboarding/provider-profile");
    }
  }

  if (!session.activeEnvironment) {
    if (session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN") {
      redirect("/onboarding/environment");
    }
    redirect("/onboarding/environment/waiting");
  }

  return <>{children}</>;
}
