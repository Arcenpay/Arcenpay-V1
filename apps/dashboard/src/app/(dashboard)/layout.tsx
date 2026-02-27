import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { DashboardShell } from "@/components/DashboardShell";
import { sessionOptions, type SessionData } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getIronSession<SessionData>(
    await cookies(),
    sessionOptions,
  );

  if (!session.isLoggedIn || !session.address) {
    redirect("/login");
  }

  return <DashboardShell>{children}</DashboardShell>;
}
