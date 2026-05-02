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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Frameworks</div>
        <div className="docs-page-title-row"><h1>Next.js Implementation</h1></div>

        <p className="docs-lead" id="nextjs">
          Next.js is the reference integration model for the current product. The dashboard
          itself uses App Router, server routes for billing APIs, and client
          components for checkout, embeds, and operational tooling.
        </p>

        <h2 id="setup">Install and configure</h2>
        <CodeBlock
          lang="bash"
          code={`npm install @arcenpay/react @arcenpay/node @arcenpay/sdk viem wagmi`}
        />

        <CodeBlock
          lang="env"
          code={`NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_GRAPH_URL_84532=https://your-subgraph
FACILITATOR_BASE_URL_84532=http://localhost:3402
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`}
        />

        <h2 id="subscriptions">Recurring subscriptions in client components</h2>
        <CodeBlock
          lang="tsx"
          code={`'use client';

import { CheckoutModal } from '@arcenpay/react';

export function SubscribeButton() {
  return (
    <CheckoutModal
      planId={1n}
      isOpen={open}
      onClose={() => setOpen(false)}
      activationEndpoint="/api/v1/subscriptions/activate"
    />
  );
}`}
        />

        <h2 id="hosted-payments">One-time hosted payments</h2>
        <CodeBlock
          lang="tsx"
          code={`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const paymentUrl = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(paymentUrl);`}
        />

        <h2 id="server-routes">Server routes and protected data</h2>
        <CodeBlock
          lang="ts"
          code={`import { NextResponse } from 'next/server';

export async function GET() {
  const response = await fetch(process.env.APP_URL + '/api/v1/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      companyId: 'company_123',
      featureKey: 'analytics_export',
    }),
  });

  const result = await response.json();
  if (!result.enabled) {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}`}
        />

        <h2 id="feature-gating">Feature checks</h2>
        <p>
          The live entitlement path is dashboard-rule based. Use the dashboard
          API or your server-side integration to verify protected access. Do not
          assume a Tableland-only flag backend.
        </p>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#nextjs">Next.js</a></li>
          <li className="docs-toc-item"><a href="#setup">Setup</a></li>
          <li className="docs-toc-item"><a href="#subscriptions">Subscriptions</a></li>
          <li className="docs-toc-item"><a href="#hosted-payments">Hosted payments</a></li>
          <li className="docs-toc-item"><a href="#server-routes">Server routes</a></li>
          <li className="docs-toc-item"><a href="#feature-gating">Feature checks</a></li>
        </ul>
      </nav>
    </div>
  );
}
