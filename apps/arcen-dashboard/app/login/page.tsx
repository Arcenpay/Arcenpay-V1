import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmailAuthFlow } from "@/components/auth/email-auth-flow";
import { getSession } from "@/lib/auth.server";
import { createPageMetadata } from "@/lib/seo";
import { resolveReturnTo } from "@/lib/return-to";

export const metadata: Metadata = createPageMetadata({
  title: "Login",
  description:
    "Access the ArcenPay provider dashboard to manage subscriptions, invoices, and environments.",
  path: "/login",
});

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string; next?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (session) {
    if (params.invite) {
      redirect(`/invite?token=${encodeURIComponent(params.invite)}`);
    }
    // Return to the originating flow (e.g. the MCP OAuth authorize URL) so a
    // ChatGPT connection can complete instead of dead-ending on the dashboard.
    const returnTo = resolveReturnTo(params.next);
    if (returnTo) {
      redirect(returnTo);
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

  return (
    <EmailAuthFlow
      inviteToken={params.invite ?? null}
      returnTo={params.next ?? null}
    />
  );
}
