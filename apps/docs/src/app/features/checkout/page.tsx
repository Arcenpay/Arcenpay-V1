import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function CheckoutPage() {
  return (
    <DocsPage
      eyebrow="Features"
      title="Checkout patterns"
      summary="ArcenPay exposes recurring subscription flows inside ArcenEmbed and hosted payment links for one-time collections. For subscriptions, buying, upgrading, downgrading, and cancelling are separate but related flows."
      toc={[
        { href: "#subscription", label: "Recurring checkout" },
        { href: "#plan-changes", label: "Upgrades and downgrades" },
        { href: "#cancellation", label: "Cancellation" },
        { href: "#hosted", label: "Hosted payment links" },
        { href: "#activation", label: "Server activation" },
        { href: "#choose", label: "Choose a flow" },
      ]}
    >
      <DocsSection id="subscription" title="Recurring subscription checkout">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The current recurring checkout surface is the published
          <code> ArcenEmbed</code> experience. It owns the billing views for
          checkout, payment, success, plan change, and unsubscribe states.
        </p>
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function PricingDialog() {
  return <ArcenEmbed mode="modal" initialView="checkout" />;
}`}
        />
      </DocsSection>

      <DocsSection id="plan-changes" title="Upgrades and downgrades">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Buying a higher plan is not treated the same as a downgrade. Paid
            upgrades can be immediate and prorated.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The upgrade path supports a preview mode first, then an
            authoritative on-chain change once required transaction hashes are available.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Lower-plan changes usually stay pending until the next renewal
            boundary instead of removing access immediately.
          </li>
        </ul>

        <DocsCodeBlock
          lang="ts"
          code={`// preview an immediate paid upgrade
await fetch("/api/v1/companies/plan", {
  method: "POST",
  body: JSON.stringify({
    planId: "plan_pro",
    previewOnly: true,
  }),
});

// finalize a verified paid upgrade
await fetch("/api/v1/companies/plan", {
  method: "POST",
  body: JSON.stringify({
    planId: "plan_pro",
    autopayConfigTxHash: "0x...",
    paymentTxHash: "0x...",
    accessChangeTxHash: "0x...",
  }),
});`}
        />
      </DocsSection>

      <DocsSection id="cancellation" title="Cancellation behavior">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Self-serve cancellation has two modes: a scheduled period-end
          cancellation that preserves current access until the term ends, and an
          explicit immediate on-chain cancellation.
        </p>
        <DocsCodeBlock
          lang="ts"
          code={`// default: keep paid access until period end
await fetch("/api/v1/companies/unsubscribe", {
  method: "POST",
  body: JSON.stringify({
    autopayControlTxHash: "0x...",
  }),
});

// explicit immediate cancellation
await fetch("/api/v1/companies/unsubscribe", {
  method: "POST",
  body: JSON.stringify({
    immediate: true,
    cancellationTxHash: "0x...",
  }),
});`}
        />
      </DocsSection>

      <DocsSection id="hosted" title="Hosted one-time payment links">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Create payment links from the dashboard or through
            <code> POST /api/v1/payment-links</code>.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Send the customer to the hosted <code>/pay/:slug</code> URL.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Use this flow for invoices, setup fees, one-off charges, or
            standalone add-ons.
          </li>
        </ul>

        <DocsCodeBlock
          lang="tsx"
          code={`import { createPaymentLinkCheckoutUrl } from "@arcenpay/react";

const url = createPaymentLinkCheckoutUrl("priority-setup-fee-ab12cd34");
window.location.assign(url);`}
        />
      </DocsSection>

      <DocsSection id="activation" title="Server-controlled activation">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The dashboard runtime uses <code>/api/v1/subscriptions/activate</code>
          for authoritative on-chain activation. If you are building a custom
          backend flow, call it through <code>ArcenClient.activateSubscription()</code>.
        </p>
        <DocsCodeBlock
          lang="ts"
          code={`const result = await client.activateSubscription({
  planId: "starter",
  paymentAccount: "0xabc...",
  company: { id: "company_123", wallet: "0xabc..." },
});`}
        />
      </DocsSection>

      <DocsSection id="choose" title="Which flow to use">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Use case</th>
              <th>Recommended flow</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Recurring subscription</td>
              <td>Published ArcenEmbed checkout</td>
            </tr>
            <tr>
              <td>Plan upgrade</td>
              <td>Published ArcenEmbed portal plus plan-change verification</td>
            </tr>
            <tr>
              <td>Plan downgrade</td>
              <td>Published ArcenEmbed portal with next-renewal scheduling</td>
            </tr>
            <tr>
              <td>Cancellation</td>
              <td>Published ArcenEmbed portal with period-end or immediate cancellation flow</td>
            </tr>
            <tr>
              <td>Invoice pay-now</td>
              <td>Hosted payment link</td>
            </tr>
            <tr>
              <td>One-off merchant charge</td>
              <td>Hosted payment link</td>
            </tr>
          </tbody>
        </table>
      </DocsSection>
    </DocsPage>
  );
}
