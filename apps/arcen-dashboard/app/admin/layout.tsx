import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createPageMetadata } from "@/lib/seo";
import { getSession } from "@/lib/auth.server";

export const metadata: Metadata = createPageMetadata({
  title: "Platform Admin Console",
  description: "Internal administrative control plane for ArcenPay licenses and activation keys.",
  path: "/admin",
  noIndex: true,
});

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defence in depth only. The authoritative boundary is requireAdminAuth() on
  // every /api/v1/admin route; page.tsx additionally gates the client UI.
  //
  // IMPORTANT: redirect solely on a *resolved non-admin* session. Returning
  // null is ambiguous — the dashboard server does not reliably see the
  // api.arcenpay.com session cookie (see proxy.ts), so redirecting on null
  // locked signed-in admins out with a /login loop. A null result falls
  // through to the client gate, which verifies against the API directly.
  const session = await getSession();
  if (session && !session.isPlatformAdmin) redirect("/");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {children}
    </div>
  );
}
