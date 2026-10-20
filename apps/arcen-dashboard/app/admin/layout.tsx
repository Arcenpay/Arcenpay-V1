import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";
import { requireAdminSession } from "@/lib/auth.server";

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
  // Server-side gate. The page itself is a client component whose only check
  // ran in the browser, so anonymous visitors were still served the admin shell.
  // Every admin API call is independently protected, but the page should never
  // render for a non-admin in the first place.
  await requireAdminSession();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      {children}
    </div>
  );
}
