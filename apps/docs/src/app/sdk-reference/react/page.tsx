import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ReactSDKPage() {
  return (
    <DocsPage
      eyebrow="Integrate"
      title="React SDK"
      summary="Use @arcenpay/react for the browser-side ArcenPay runtime: provider setup, customer identification, ArcenEmbed billing surfaces, feature and entitlement hooks, usage consumption, tracking, and hosted payment-link helpers."
      toc={[
        { href: "#install", label: "Install" },
        { href: "#provider", label: "Provider" },
        { href: "#identify", label: "Identify" },
        { href: "#embed", label: "ArcenEmbed" },
        { href: "#hooks", label: "Hooks" },
        { href: "#helpers", label: "Helpers" },
      ]}
    >
      <DocsSection id="install" title="Install">
        <DocsCodeBlock lang="bash" code={`npm install @arcenpay/react`} />
      </DocsSection>

      <DocsSection id="provider" title="Initialize the provider">
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

      <DocsSection id="identify" title="Identify the active customer">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useEffect } from "react";
import { useArcenPay } from "@arcenpay/react";

export function BillingIdentity({
  companyId,
  wallet,
}: {
  companyId: string;
  wallet: string;
}) {
  const { identify } = useArcenPay();

  useEffect(() => {
    if (!wallet) return;

    void identify({
      company: { id: companyId, wallet, name: "Acme" },
      user: { id: \`user-\${companyId}\`, wallet },
    });
  }, [companyId, identify, wallet]);

  return null;
}`}
        />
      </DocsSection>

      <DocsSection id="embed" title="Render ArcenEmbed">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function BillingRoute() {
  return <ArcenEmbed mode="modal" initialView="portal" />;
}`}
        />
        <p className="text-[15px] text-muted-foreground leading-relaxed mt-[15px] mb-0">
          If you mint a short-lived token on your backend, you can pass it
          directly to <code>ArcenEmbed</code> with the
          <code> accessToken</code> prop for embed-only surfaces.
        </p>
      </DocsSection>

      <DocsSection id="hooks" title="Main hooks">
        <DocsCodeBlock
          lang="tsx"
          code={`import {
  useConsumeEntitlement,
  useEntitlement,
  useFlag,
  useFlags,
  useTrack,
} from "@arcenpay/react";

const scanEnabled = useFlag("scan");
const flags = useFlags(["scan", "export-pdf"]);
const entitlement = useEntitlement(walletAddress, "scan");
const { consume } = useConsumeEntitlement();
const { track } = useTrack();

await consume("scan");
await track("scan_started", { source: "dashboard" });`}
        />
      </DocsSection>

      <DocsSection id="helpers" title="Helpers and components">
        <DocsCodeBlock
          lang="tsx"
          code={`import {
  FeatureFlagGuard,
  TemplateRenderer,
  createPaymentLinkCheckoutUrl,
} from "@arcenpay/react";

const url = createPaymentLinkCheckoutUrl("priority-setup-fee-ab12cd34");

<FeatureFlagGuard featureKey="scan" walletAddress={walletAddress}>
  <button>Run premium action</button>
</FeatureFlagGuard>

<TemplateRenderer name="upgrade-card" blocks={blocks} />`}
        />
      </DocsSection>
    </DocsPage>
  );
}
