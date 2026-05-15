import type { Metadata } from "next";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Workspace Invitation",
  description: "Accept a workspace invitation to join your ArcenPay dashboard.",
  path: "/invite",
  noIndex: true,
});

export default function InviteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
