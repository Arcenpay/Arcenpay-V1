import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function NextJSPage() {
  return (
    <DocsPage
      eyebrow="Frameworks"
      title="Next.js integration"
      summary="Next.js works well with ArcenPay because you can keep secure billing logic inside Route Handlers while rendering the customer billing experience with the React SDK in the same App Router application."
      toc={[
        { href: "#install", label: "Install" },
        { href: "#env", label: "Environment" },
        { href: "#provider", label: "Provider" },
        { href: "#identify", label: "Identify" },
        { href: "#embed", label: "Embed" },
        { href: "#webhooks", label: "Webhooks" },
      ]}
    >
      <DocsSection id="install" title="Install">
        <DocsCodeBlock
          lang="bash"
          code={`npm install @arcenpay/react
npm install @arcenpay/node`}
        />
      </DocsSection>

      <DocsSection id="env" title="Common environment variables">
        <DocsCodeBlock
          lang="env"
          code={`NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY=pk_xxxxxxxxx
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=cmp_xxxxxxxxx
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=xxxxxxxxx
NEXT_PUBLIC_ARCENPAY_BASE_URL=http://localhost:3000

ARCENPAY_API_KEY=api_xxxxxxxxx
ARCENPAY_BASE_URL=http://localhost:3000
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx`}
        />
      </DocsSection>

      <DocsSection id="provider" title="App provider">
        <DocsCodeBlock
          lang="tsx"
          code={`"use client";

import { ArcenPayProvider } from "@arcenpay/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ArcenPayProvider
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
    >
      {children}
    </ArcenPayProvider>
  );
}`}
        />
      </DocsSection>

      <DocsSection id="identify" title="Identify the company or user on the client">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useEffect } from "react";
import { useArcenPay } from "@arcenpay/react";

export function BillingIdentity({ wallet }: { wallet: string }) {
  const { identify } = useArcenPay();

  useEffect(() => {
    if (!wallet) return;
    void identify({
      company: { id: "company_123", wallet },
      user: { id: "user_123", wallet },
    });
  }, [identify, wallet]);

  return null;
}`}
        />
      </DocsSection>

      <DocsSection id="embed" title="Render the billing route">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export default function BillingPage() {
  return <ArcenEmbed mode="modal" />;
}`}
        />
      </DocsSection>

      <DocsSection id="webhooks" title="Webhook route">
        <DocsCodeBlock
          lang="ts"
          code={`import { verifyWebhookSignature } from "@arcenpay/node";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-meap-signature") ?? "";
  const signature =
    signatureHeader.startsWith("sha256=")
      ? signatureHeader.slice("sha256=".length)
      : signatureHeader;

  if (!verifyWebhookSignature(rawBody, signature, process.env.ARCENPAY_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  return NextResponse.json({ received: true });
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
