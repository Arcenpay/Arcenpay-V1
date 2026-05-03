export default function CheckoutPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Core Features</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Checkout Patterns</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="checkout">
          ArcenPay now has two checkout paths: a recurring subscription flow
          for plans, and a hosted one-time Base Sepolia USDC flow for add-ons,
          invoice payments, and custom charges.
        </p>

        <h2 id="subscription-checkout">Subscription checkout</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
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
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use hosted checkout when you want a gateway-style one-time payment
          experience. This powers standalone add-ons, invoice pay-now links,
          and custom merchant charges.
        </p>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Create a payment link in the dashboard or through `POST /api/v1/payment-links`.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Send customers to `/pay/:slug`.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">The customer transfers the exact Base Sepolia USDC amount.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">ArcenPay verifies the tx hash, records the payment, and issues invoice/add-on effects when relevant.</li>
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
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
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

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#subscription-checkout">Subscription checkout</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hosted-payments">Hosted payments</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hosted-payments-api">Hosted payments API</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#when-to-use-which">When to use which</a></li>
        </ul>
      </nav>
    </div>
  );
}
