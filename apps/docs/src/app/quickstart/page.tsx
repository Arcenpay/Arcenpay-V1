export default function QuickstartPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">
          Getting Started
        </div>
        <div className="flex items-center justify-between gap-4 mb-3.5">
          <h1 className="text-[clamp(30px,4vw,42px)] font-bold tracking-[-0.04em] leading-tight">
            Base Sepolia Quickstart
          </h1>
        </div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="quickstart">
          This path gets you from zero to a working ArcenPay integration with
          recurring subscriptions, hosted payment links, and backend access
          checks on Base Sepolia.
        </p>

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            <strong>Before you start:</strong> create your workspace, link the
            wallet that should receive funds, publish at least one plan or
            payment link in the dashboard, and generate an API key for server-side use.
          </div>
        </div>

        <h2 id="build-flow" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          Build flow
        </h2>
        <div className="docs-steps">
          {[
            { num: "1", title: "Install the public SDKs", desc: "Use the React SDK for customer-facing checkout and the Node SDK for backend verification." },
            { num: "2", title: "Wrap your app with the provider", desc: "Configure wallet connection and pass a short-lived ArcenPay access token from your backend." },
            { num: "3", title: "Launch the right checkout", desc: "Use CheckoutModal for recurring plans and hosted payment-link URLs for one-time charges." },
            { num: "4", title: "Verify billing on your backend", desc: "Use the Node SDK for entitlement checks and verify webhook signatures before updating your app state." },
          ].map((step) => (
            <div key={step.num} className="docs-step">
              <div className="docs-step-num">{step.num}</div>
              <div className="docs-step-body">
                <div className="docs-step-title">{step.title}</div>
                <p className="docs-step-desc">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <h2 id="install" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          1. Install packages
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">bash</span>
          </div>
          <pre><code>{`npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query
npm install @arcenpay/node`}</code></pre>
        </div>

        <h2 id="provider" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          2. Wrap your app
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre><code>{`'use client';
import { ArcenPayProvider } from '@arcenpay/react';

export function Providers({
  children,
  accessToken,
}: {
  children: React.ReactNode;
  accessToken: string;
}) {
  return (
    <ArcenPayProvider
      chainId={84532}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
      token={accessToken}
    >
      {children}
    </ArcenPayProvider>
  );
}`}</code></pre>
        </div>

        <h2 id="subscriptions" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          3. Launch subscription checkout
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre><code>{`import { CheckoutModal } from '@arcenpay/react';

<CheckoutModal
  planId={1n}
  isOpen={showCheckout}
  onClose={() => setShowCheckout(false)}
  activationEndpoint="/api/v1/subscriptions/activate"
/>`}</code></pre>
        </div>

        <h2 id="hosted-payments" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          4. Launch hosted one-time payments
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Create payment links from the dashboard for setup fees, invoice collection,
          or one-off charges, then send customers to the hosted checkout URL.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre><code>{`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const checkoutUrl = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(checkoutUrl);`}</code></pre>
        </div>

        <h2 id="server-checks" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          5. Verify access on the server
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">ts</span>
          </div>
          <pre><code>{`import { ArcenClient } from '@arcenpay/node';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL,
});

await client.identify({
  company: { id: 'company_123' },
  user: { wallet: '0xabc...' },
});

const entitlement = await client.checkEntitlement('analytics_export');`}</code></pre>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">
          On this page
        </div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a href="#build-flow" className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground">Build flow</a></li>
          <li className="toc-item"><a href="#install" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Install</a></li>
          <li className="toc-item"><a href="#provider" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Provider</a></li>
          <li className="toc-item"><a href="#subscriptions" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Subscriptions</a></li>
          <li className="toc-item"><a href="#hosted-payments" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Hosted payments</a></li>
          <li className="toc-item"><a href="#server-checks" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Server checks</a></li>
        </ul>
      </nav>
    </div>
  );
}
