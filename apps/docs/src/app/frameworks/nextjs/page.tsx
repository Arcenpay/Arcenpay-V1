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

export default function NextJSPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Frameworks</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Next.js Integration</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="nextjs">
          Next.js is a strong fit for ArcenPay because it lets you combine
          customer-facing React checkout with secure server routes for identify,
          activation, and webhook verification.
        </p>

        <h2 id="setup">Install and configure</h2>
        <CodeBlock
          lang="bash"
          code={`npm install @arcenpay/react @arcenpay/sdk @arcenpay/node wagmi viem @tanstack/react-query`}
        />

        <CodeBlock
          lang="env"
          code={`NEXT_PUBLIC_ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
ARCENPAY_API_KEY=api_live_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx`}
        />

        <h2 id="provider">Client provider</h2>
        <CodeBlock
          lang="tsx"
          code={`'use client';

import { ArcenPayProvider } from '@arcenpay/react';

export function BillingProviders({
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
}`}        />

        <h2 id="subscriptions">Recurring subscriptions</h2>
        <CodeBlock
          lang="tsx"
          code={`import { CheckoutModal } from '@arcenpay/react';

<CheckoutModal
  planId={selectedPlan}
  activationEndpoint="/api/v1/subscriptions/activate"
  onClose={() => setSelectedPlan(null)}
/>`}        />

        <h2 id="hosted-payments">Hosted one-time payments</h2>
        <CodeBlock
          lang="tsx"
          code={`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const paymentUrl = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(paymentUrl);`}        />

        <h2 id="server-routes">Server-side checks</h2>
        <CodeBlock
          lang="ts"
          code={`import { ArcenClient } from '@arcenpay/node';
import { NextResponse } from 'next/server';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL,
});

export async function GET() {
  await client.identify({
    company: { id: 'company_123' },
    user: { wallet: '0xabc...' },
  });

  const entitlement = await client.checkEntitlement('analytics_export');
  if (!entitlement.enabled) {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}`}        />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#nextjs">Next.js</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#provider">Provider</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#subscriptions">Subscriptions</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hosted-payments">Hosted payments</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#server-routes">Server routes</a></li>
        </ul>
      </nav>
    </div>
  );
}
