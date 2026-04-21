import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.server";
import { db } from "@/lib/db";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { walletAddress: true },
  });

  if (!user?.walletAddress) {
    redirect("/onboarding/wallet");
  }

  return <>{children}</>;
}
