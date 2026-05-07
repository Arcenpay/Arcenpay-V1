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
      summary="ArcenPay currently exposes two main checkout paths: recurring subscription flows inside ArcenEmbed and hosted payment links for one-time collections such as invoice pay-now actions, setup fees, or standalone add-ons."
      toc={[
        { href: "#subscription", label: "Recurring checkout" },
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
              <td>Plan upgrade or self-serve billing</td>
              <td>Published ArcenEmbed portal</td>
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
