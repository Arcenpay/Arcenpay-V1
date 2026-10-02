import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmailAuthFlow } from "@/components/auth/email-auth-flow";
import { getSession } from "@/lib/auth.server";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Login",
  description:
    "Access the ArcenPay provider dashboard to manage subscriptions, invoices, and environments.",
  path: "/login",
});

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session) {
    if (params.invite) {
      redirect(`/invite?token=${encodeURIComponent(params.invite)}`);
    }
    const hasWallet = Boolean(
      session.walletAddress ||
      session.stellarWalletAddress ||
      session.solanaWalletAddress,
    );
    if (hasWallet) {
      const environments = Array.isArray(session.environments) ? session.environments : [];
      redirect(environments.length > 0 ? "/" : "/onboarding/provider-profile");
    }
  }

  return <EmailAuthFlow inviteToken={params.invite ?? null} />;
}
