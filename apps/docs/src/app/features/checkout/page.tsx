export default function CheckoutPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Features</div>
        <div className="docs-page-title-row"><h1>Checkout Patterns</h1></div>

        <p className="docs-lead" id="checkout">
          ArcenPay now has two checkout paths: a recurring subscription flow
          for plans, and a hosted one-time Base Sepolia USDC flow for add-ons,
          invoice payments, and custom charges.
        </p>

        <h2 id="subscription-checkout">Subscription checkout</h2>
        <p>
          Use `CheckoutModal` when the customer is starting a recurring plan.
          The modal handles wallet connection, smart-account setup, autopay
          configuration, token approval, and backend activation.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header"><span className="docs-codeblock-lang">tsx</span></div>
          <pre>
            <code>{`import { CheckoutModal } from '@arcenpay/react';

<CheckoutModal
  planId={1n}
  isOpen={open}
  onClose={() => setOpen(false)}
  activationEndpoint="https://dashboard.yourapp.com/api/v1/subscriptions/activate"
/>`}</code>
          </pre>
        </div>

        <h2 id="hosted-payments">Hosted one-time payments</h2>
        <p>
          Use hosted checkout when you want a gateway-style one-time payment
          experience. This powers standalone add-ons, invoice pay-now links,
          and custom merchant charges.
        </p>
        <ul>
          <li>Create a payment link in the dashboard or through `POST /api/v1/payment-links`.</li>
          <li>Send customers to `/pay/:slug`.</li>
          <li>The customer transfers the exact Base Sepolia USDC amount.</li>
          <li>ArcenPay verifies the tx hash, records the payment, and issues invoice/add-on effects when relevant.</li>
        </ul>

        <h2 id="hosted-payments-api">Hosted payments API</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header"><span className="docs-codeblock-lang">bash</span></div>
          <pre>
            <code>{`POST /api/v1/payment-links
POST /api/v1/checkout-sessions
GET  /api/v1/checkout-sessions/:id
GET  /api/public/checkout/:sessionId
POST /api/public/checkout/:sessionId/confirm`}</code>
          </pre>
        </div>

        <h2 id="sdk-helper">SDK helper</h2>
        <p>
          If you already have a payment-link slug, the React SDK exposes a URL
          helper instead of forcing the recurring checkout modal to handle
          one-time payments too.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header"><span className="docs-codeblock-lang">tsx</span></div>
          <pre>
            <code>{`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const url = createPaymentLinkCheckoutUrl('priority-setup-fee-ab12cd34');
window.location.assign(url);`}</code>
          </pre>
        </div>

        <h2 id="when-to-use-which">When to use which flow</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Use case</th><th>Recommended flow</th></tr>
          </thead>
          <tbody>
            <tr><td>Recurring plan</td><td>`CheckoutModal` + `/api/v1/subscriptions/activate`</td></tr>
            <tr><td>Standalone add-on</td><td>Hosted payment link</td></tr>
            <tr><td>Invoice pay-now</td><td>Hosted payment link</td></tr>
            <tr><td>One-off merchant charge</td><td>Hosted payment link</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#subscription-checkout">Subscription checkout</a></li>
          <li className="docs-toc-item"><a href="#hosted-payments">Hosted payments</a></li>
          <li className="docs-toc-item"><a href="#hosted-payments-api">Hosted payments API</a></li>
          <li className="docs-toc-item"><a href="#when-to-use-which">When to use which</a></li>
        </ul>
      </nav>
    </div>
  );
}
