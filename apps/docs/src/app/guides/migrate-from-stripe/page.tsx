import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function StripeMigrationGuide() {
  return (
    <DocsPage
      eyebrow="Guides"
      title="Migrate from Stripe"
      summary="Move recurring billing and invoice collection from Stripe to ArcenPay in stages so customers can keep using your product while you switch checkout, payment links, and access logic."
      toc={[
        { href: "#mapping", label: "Concept mapping" },
        { href: "#plans", label: "Map plans" },
        { href: "#checkout", label: "Switch checkout" },
        { href: "#access", label: "Update access checks" },
        { href: "#invoices", label: "Move invoices" },
      ]}
    >
      <DocsSection id="mapping" title="Concept mapping">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Stripe</th>
              <th>ArcenPay</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Product / Price</td><td>Plan or add-on in the dashboard catalog</td></tr>
            <tr><td>Customer</td><td>Company plus optional user identity</td></tr>
            <tr><td>Hosted customer portal</td><td>Published ArcenEmbed component</td></tr>
            <tr><td>Invoice payment link</td><td>Hosted payment link</td></tr>
            <tr><td>Webhooks</td><td>Signed ArcenPay webhooks</td></tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection id="plans" title="1. Recreate plans and flags">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-0">
          Rebuild your plan catalog, add-ons, and feature mapping in ArcenPay
          before switching any production access checks.
        </p>
      </DocsSection>

      <DocsSection id="checkout" title="2. Switch new checkout flows">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function PricingDialog() {
  return <ArcenEmbed mode="modal" initialView="checkout" />;
}`}
        />
      </DocsSection>

      <DocsSection id="access" title="3. Update access checks">
        <DocsCodeBlock
          lang="ts"
          code={`const entitlement = await client.checkEntitlement("analytics_export", {
  id: account.arcenCompanyId,
});

const hasAccess = entitlement.enabled;`}
        />
      </DocsSection>

      <DocsSection id="invoices" title="4. Replace invoice and one-time collection links">
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
