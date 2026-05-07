import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../_components/DocsPrimitives";

export default function QuickstartPage() {
  return (
    <DocsPage
      eyebrow="Getting Started"
      title="Platform quickstart"
      summary="This is the shortest accurate path through the current platform: configure the dashboard, initialize the React SDK with a publishable key, identify the customer, render ArcenEmbed, and keep secure billing decisions on your backend with the Node SDK."
      toc={[
        { href: "#dashboard", label: "Dashboard setup" },
        { href: "#env", label: "Environment" },
        { href: "#provider", label: "Provider" },
        { href: "#identify", label: "Identify" },
        { href: "#embed", label: "Render billing" },
        { href: "#backend", label: "Backend checks" },
      ]}
    >
      <DocsSection id="dashboard" title="1. Finish dashboard setup first">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Create at least one published plan.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Configure any add-ons, credits, or payment links you want to expose.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Publish a billing component for ArcenEmbed.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Generate an API key, publishable key, and webhook signing secret.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="env" title="2. Add the common environment variables">
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

      <DocsSection id="provider" title="3. Wrap your app with the provider">
        <DocsCodeBlock
          lang="tsx"
          code={`"use client";

import type { ReactNode } from "react";
import { ArcenPayProvider } from "@arcenpay/react";

export function Providers({ children }: { children: ReactNode }) {
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

      <DocsSection id="identify" title="4. Identify the active company or user">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The current React SDK path uses the provider plus
          <code> identify()</code>. Call it once your app has resolved the
          customer identity or connected wallet.
        </p>
        <DocsCodeBlock
          lang="tsx"
          code={`"use client";

import { useEffect } from "react";
import { useArcenPay } from "@arcenpay/react";

export function BillingSession({
  companyId,
  wallet,
}: {
  companyId: string;
  wallet: string;
}) {
  const { identify, session } = useArcenPay();

  useEffect(() => {
    if (!wallet) return;
    if (session.company?.wallet?.toLowerCase() === wallet.toLowerCase()) return;

    void identify({
      company: { id: companyId, wallet, name: "Acme" },
      user: { id: \`user-\${companyId}\`, wallet, name: "Workspace owner" },
    });
  }, [companyId, identify, session.company?.wallet, wallet]);

  return null;
}`}
        />
      </DocsSection>

      <DocsSection id="embed" title="5. Render billing in your app">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          A published ArcenEmbed component is the current supported checkout and
          self-serve billing surface. It can render portal, checkout, payment,
          unsubscribe, and success states.
        </p>
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function BillingPage() {
  return <ArcenEmbed mode="modal" />;
}`}
        />
        <p className="text-[15px] text-muted-foreground leading-relaxed mt-[15px] mb-0">
          If you prefer a server-issued embed token for a single surface, you
          can still mint one with the Node SDK and pass it directly to
          <code> ArcenEmbed</code> through the <code>accessToken</code> prop.
        </p>
      </DocsSection>

      <DocsSection id="backend" title="6. Keep billing decisions on the server">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

const entitlement = await client.checkEntitlement("scan", {
  id: "company_123",
});

if (!entitlement.enabled) {
  throw new Error("Upgrade required");
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
