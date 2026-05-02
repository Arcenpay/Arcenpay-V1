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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Developers</div>
        <div className="docs-page-title-row"><h1>SDK Reference</h1></div>

        <p className="docs-lead" id="sdk-reference">
          The supported SDK surface is split across React checkout/UI helpers,
          server-side verification and billing clients, and agent/session tools
          for x402-style usage billing. All runtime examples below assume Base
          Sepolia (<code>84532</code>).
        </p>

        <h2 id="packages">Packages</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Package</th><th>Use it for</th><th>Install</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@arcenpay/react</code></td>
              <td>Checkout components, embed helpers, entitlement hooks</td>
              <td><code>npm install @arcenpay/react @arcenpay/sdk viem wagmi</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/node</code></td>
              <td>Backend verification, facilitator helpers, usage services</td>
              <td><code>npm install @arcenpay/node viem</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/agent</code></td>
              <td>Agent-funded sessions and x402 request signing</td>
              <td><code>npm install @arcenpay/agent viem</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="react">React checkout and hosted payments</h2>
        <CodeBlock
          lang="tsx"
          code={`import { CheckoutModal, createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const recurringCheckout = (
  <CheckoutModal
    planId={1n}
    isOpen={open}
    onClose={() => setOpen(false)}
    activationEndpoint="/api/v1/subscriptions/activate"
  />
);

const hostedCheckoutUrl = createPaymentLinkCheckoutUrl('priority-setup-fee-ab12cd34');`}
        />

        <h2 id="provider-config">Runtime configuration</h2>
        <CodeBlock
          lang="tsx"
          code={`import { ArcenPayProvider } from '@arcenpay/react';

<ArcenPayProvider chainId={84532}>
  <App />
</ArcenPayProvider>`}
        />

        <h2 id="server">Server-side checks</h2>
        <CodeBlock
          lang="ts"
          code={`import { createArcenPayClient } from '@arcenpay/node';

const client = createArcenPayClient({
  chainId: 84532,
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL,
  facilitatorUrl: process.env.FACILITATOR_BASE_URL_84532,
});

const result = await client.check({
  companyId: 'company_123',
  featureKey: 'analytics_export',
});`}
        />

        <h2 id="agent">Agent and session tooling</h2>
        <CodeBlock
          lang="ts"
          code={`import { x402Client } from '@arcenpay/agent';

const client = x402Client({
  sessionId,
  sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS,
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

const response = await client.get('https://api.example.com/premium-data');`}
        />

        <h2 id="what-not-to-assume">What not to assume</h2>
        <ul>
          <li>The hosted one-time payment flow is separate from recurring subscription checkout.</li>
          <li>Feature gating is dashboard-rule and add-on-grant driven, not a Tableland-only model.</li>
          <li>Base Sepolia is the supported runtime in these docs unless a page explicitly says legacy reference.</li>
        </ul>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sdk-reference">SDK Reference</a></li>
          <li className="docs-toc-item"><a href="#packages">Packages</a></li>
          <li className="docs-toc-item"><a href="#react">React checkout</a></li>
          <li className="docs-toc-item"><a href="#provider-config">Runtime config</a></li>
          <li className="docs-toc-item"><a href="#server">Server checks</a></li>
          <li className="docs-toc-item"><a href="#agent">Agent tooling</a></li>
        </ul>
      </nav>
    </div>
  );
}
