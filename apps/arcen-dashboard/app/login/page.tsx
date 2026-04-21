import { redirect } from "next/navigation";
import { EmailAuthFlow } from "@/components/auth/email-auth-flow";
import { getSession } from "@/lib/auth.server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session) {
    redirect(session.walletAddress ? "/" : "/onboarding/wallet");
  }

  return <EmailAuthFlow inviteToken={params.invite ?? null} />;
}
