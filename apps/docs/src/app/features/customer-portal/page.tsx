import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function CustomerPortalPage() {
  return (
    <DocsPage
      eyebrow="Features"
      title="Customer portal"
      summary="A customer portal gives people a self-serve place to manage their plan, view invoices, understand payment state, and review usage or entitlement context. In the current platform, that portal is usually a published ArcenEmbed component."
      toc={[
        { href: "#surface", label: "Portal surface" },
        { href: "#embed", label: "Embed" },
        { href: "#summary", label: "Access summary" },
        { href: "#paynow", label: "Pay-now actions" },
      ]}
    >
      <DocsSection id="surface" title="What the portal can include">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Current plan, renewal state, and self-serve cancellation.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Available plans or upgrade paths.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Invoice history, payment status, and hosted pay-now links.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Usage or entitlement blocks tied to the current company.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="embed" title="Render the portal">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function BillingCenter() {
  return <ArcenEmbed mode="modal" initialView="portal" />;
}`}
        />
      </DocsSection>

      <DocsSection id="summary" title="Show the current access state elsewhere in the app">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useEntitlement } from "@arcenpay/react";

function CurrentPlan({ walletAddress }: { walletAddress: string }) {
  const { planTier, isSubscribed } = useEntitlement(walletAddress);

  return (
    <p>{isSubscribed ? \`Active plan: \${planTier}\` : "No active subscription"}</p>
  );
}`}
        />
      </DocsSection>

      <DocsSection id="paynow" title="Add one-time pay-now actions">
        <DocsCodeBlock
          lang="tsx"
          code={`import { createPaymentLinkCheckoutUrl } from "@arcenpay/react";

const url = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(url);`}
        />
      </DocsSection>
    </DocsPage>
  );
}
