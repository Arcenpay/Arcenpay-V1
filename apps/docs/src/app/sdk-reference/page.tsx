'use client';

import { useState } from 'react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button
          className="docs-codeblock-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function SDKReferencePage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Developers</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>SDK Reference</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="sdk-reference">
          ArcenPay exposes a small public SDK surface for product integrations:
          React components for checkout and entitlements, and a Node client for
          secure server-side billing, access checks, and webhook verification.
        </p>

        <h2 id="packages">Packages</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Package</th><th>Use it for</th><th>Install</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@arcenpay/react</code></td>
              <td>Checkout UI, hosted payment helpers, billing history, entitlement hooks</td>
              <td><code>npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/node</code></td>
              <td>Server-side identify, entitlement checks, subscription activation, webhook verification</td>
              <td><code>npm install @arcenpay/node</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="react">React integration</h2>
        <CodeBlock
          lang="tsx"
          code={`import { CheckoutModal, createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const hostedCheckoutUrl = createPaymentLinkCheckoutUrl(paymentLink.slug);

<CheckoutModal
  planId={1n}
  isOpen={showCheckout}
  onClose={() => setShowCheckout(false)}
  activationEndpoint="/api/v1/subscriptions/activate"
/>`}
        />

        <h2 id="node">Node integration</h2>
        <CodeBlock
          lang="ts"
          code={`import { ArcenClient } from '@arcenpay/node';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL,
});

await client.identify({
  company: { id: 'company_123' },
  user: { wallet: '0xabc...' },
});

const result = await client.checkEntitlement('analytics_export');`}
        />

        <h2 id="webhooks">Webhook verification</h2>
        <CodeBlock
          lang="ts"
          code={`import { verifyWebhookSignature } from '@arcenpay/node';

const rawBody = requestBodyAsString;
const signature = req.headers['x-meap-signature'];

const isValid = verifyWebhookSignature(
  rawBody,
  String(signature),
  process.env.ARCENPAY_WEBHOOK_SECRET!,
);`}
        />

        <h2 id="public-surface">Public integration surface</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the dashboard for plans, payment links, invoices, and customer operations.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the React SDK for checkout and customer-facing billing UI.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the Node SDK for backend access checks and secure workflow automation.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Do not depend on internal contracts, indexers, or protocol implementation details in your app code.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#sdk-reference">SDK Reference</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#packages">Packages</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react">React integration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#node">Node integration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhook verification</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#public-surface">Public surface</a></li>
        </ul>
      </nav>
    </div>
  );
}
