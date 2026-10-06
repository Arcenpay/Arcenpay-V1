import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth.server";
import { createPageMetadata } from "@/lib/seo";
import { BACKEND_URL } from "@/lib/config";
import { OAuthConsent } from "@/components/mcp/oauth-consent";

export const metadata: Metadata = createPageMetadata({
  title: "Authorize access",
  description: "Authorize an application to read your ArcenPay account.",
  path: "/oauth/authorize",
});

type SearchParams = Record<string, string | string[] | undefined>;

function toQuery(params: SearchParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") search.set(key, value);
    else if (Array.isArray(value) && typeof value[0] === "string") {
      search.set(key, value[0]);
    }
  }
  return search.toString();
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = toQuery(params);

  // Consent requires a session. If absent, log in first and come straight back
  // here (see resolveReturnTo in lib/return-to.ts).
  const session = await getSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`);
  }

  const redirectUri =
    typeof params.redirect_uri === "string" ? params.redirect_uri : "";
  const state = typeof params.state === "string" ? params.state : "";
  const authorizeUrl = `${BACKEND_URL.replace(/\/+$/, "")}/oauth/authorize?${query}`;

  return (
    <OAuthConsent
      authorizeUrl={authorizeUrl}
      redirectUri={redirectUri}
      state={state}
      accountEmail={session.email ?? undefined}
    />
  );
}
