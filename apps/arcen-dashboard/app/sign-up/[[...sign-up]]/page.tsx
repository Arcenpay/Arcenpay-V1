import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Sign Up Redirect",
  path: "/sign-up",
  noIndex: true,
});

export default function SignUpPage() {
  redirect("/login");
}
