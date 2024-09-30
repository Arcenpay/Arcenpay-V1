import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Single Sign-On Callback",
  path: "/sso-callback",
  noIndex: true,
});

export default function SsoCallbackPage() {
  redirect("/login");
}
