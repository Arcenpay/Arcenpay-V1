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
          ArcenPay exposes three public packages for platform integrations:
          a React SDK for checkout and embedded billing UI, a Node SDK for
          secure server-side workflows, and an agent SDK for autonomous x402
          payment settlement.
        </p>

        <h2 id="packages">Packages</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Package</th><th>Use it for</th><th>Install</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@arcenpay/react</code></td>
              <td>Checkout UI, ArcenEmbed surfaces, billing history, feature-flag hooks, usage tracking</td>
              <td><code>npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/node</code></td>
              <td>Server-side identify, entitlement checks, subscription activation, invoice and webhook workflows</td>
              <td><code>npm install @arcenpay/node</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/agent</code></td>
              <td>x402 client for session funding, auto-topup, persistent state, and paid fetch flows</td>
              <td><code>npm install @arcenpay/agent</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="react">React integration</h2>
        <CodeBlock
          lang="tsx"
          code={`import {
  ArcenPayProvider,
  CheckoutModal,
  ArcenEmbed,
  useFlag,
} from '@arcenpay/react';

function BillingExperience({ token }: { token: string }) {
  const analytics = useFlag('analytics_export', { id: 'company_123' });

  return (
    <>
      <CheckoutModal
        planId={1n}
        isOpen
        onClose={() => {}}
        activationEndpoint="/api/v1/subscriptions/activate"
      />
      <ArcenEmbed accessToken={token} componentId="cmp_123" />
      {analytics.value ? <button>Export</button> : null}
    </>
  );
}

function BillingSurface({ token }: { token: string }) {
  return (
    <ArcenPayProvider chainId={84532} token={token}>
      <BillingExperience token={token} />
    </ArcenPayProvider>
  );
}`}
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

        <h2 id="agent">Agent integration</h2>
        <CodeBlock
          lang="ts"
          code={`import { MEAPAgent, FileStore } from '@arcenpay/agent';

const agent = new MEAPAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.BASE_RPC_URL!,
  chainId: 84532,
  maxAutoApprove: '0.02',
  store: new FileStore('/tmp/arcenpay-agent-state.json'),
});

await agent.restore();
await agent.fundSession('5');

const response = await agent.fetch('https://merchant.example/x402/resource', {
  method: 'POST',
  autoApprove: true,
});`}
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
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the dashboard for plans, invoices, feature flags, embedded components, and customer operations.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the React SDK for checkout, portal embeds, usage displays, and entitlement-aware UI.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the Node SDK for backend access checks, subscription activation, and webhook verification.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the agent SDK when your buyer is a service or autonomous agent that needs x402-compatible paid requests.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Do not depend on private dashboard tables or low-level contract orchestration in app code unless you explicitly own that infrastructure.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#sdk-reference">SDK Reference</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#packages">Packages</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react">React integration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#node">Node integration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#agent">Agent integration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhook verification</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#public-surface">Public surface</a></li>
        </ul>
      </nav>
    </div>
  );
}
