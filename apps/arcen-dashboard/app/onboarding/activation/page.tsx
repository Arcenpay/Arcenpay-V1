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

interface ActivationPageProps {
  searchParams?: Promise<{ key?: string }>;
}

export default async function ActivationPage({ searchParams }: ActivationPageProps) {
  const params = await searchParams;
  return <EmailAuthFlow initialStep="activate" initialKey={params?.key} />;
}
