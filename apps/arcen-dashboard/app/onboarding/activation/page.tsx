import type { Metadata } from "next";
import { EmailAuthFlow } from "@/components/auth/email-auth-flow";
import { createPageMetadata } from "@/lib/seo";

export const metadata: Metadata = createPageMetadata({
  title: "Activate Workspace",
  description:
    "Enter your platform activation key to unlock the ArcenPay billing control plane.",
  path: "/onboarding/activation",
  noIndex: true,
});

export default function ActivationPage() {
  return <EmailAuthFlow initialStep="activate" />;
}
