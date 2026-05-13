import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.server";

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

  if (!session.activeEnvironment) {
    if (session.currentTeamRole === "OWNER" || session.currentTeamRole === "ADMIN") {
      redirect("/onboarding/environment");
    }
    redirect("/onboarding/environment/waiting");
  }

  return <>{children}</>;
}
