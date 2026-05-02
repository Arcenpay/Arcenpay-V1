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

const contracts = [
  ['PlanFactory', 'Creates plans and provider-level catalog state.'],
  ['SubscriptionRegistry', 'Stores the subscription NFT lifecycle and renewal state.'],
  ['ERC7579AutopayModule', 'Handles recurring pulls for subscriber smart accounts.'],
  ['FeeCollector', 'Tracks protocol fees for subscription and usage billing.'],
  ['SessionVault', 'Holds prefunded balances for x402 and proof-based settlement.'],
  ['ZKUsageVerifier', 'Settles metered sessions after proof verification.'],
];

export default function ArchitecturePage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row"><h1>Architecture</h1></div>

        <p className="docs-lead" id="architecture">
          ArcenPay has two real production-facing paths in the current platform:
          recurring subscription billing for plans, and hosted one-time USDC
          payments for add-ons, invoice pay-now links, and custom charges. The
          current hardening pass standardizes the runtime on Base Sepolia
          (84532).
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">i</span>
          <div>
            Base Sepolia is the primary runtime. Legacy Sepolia references may
            still exist in low-priority docs or old examples, but the active
            dashboard, facilitator, and hosted payment work should be configured
            for chain ID <code>84532</code>.
          </div>
        </div>

        <h2 id="system-overview">System overview</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Layer</th><th>Responsibility</th><th>Where it lives</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Dashboard</td>
              <td>Catalog, companies, invoices, payment links, checkout sessions, feature rules</td>
              <td><code>apps/arcen-dashboard</code></td>
            </tr>
            <tr>
              <td>Facilitator</td>
              <td>x402 usage settlement, proof orchestration, operational adjunct APIs</td>
              <td><code>apps/facilitator</code></td>
            </tr>
            <tr>
              <td>Contracts</td>
              <td>Plans, subscriptions, autopay, fee collection, session vaults, proof settlement</td>
              <td><code>packages/contracts</code></td>
            </tr>
            <tr>
              <td>SDKs</td>
              <td>Subscription checkout, entitlement checks, session and x402 helpers</td>
              <td><code>packages/sdk-*</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="billing-paths">Billing paths</h2>
        <div className="docs-lifecycle">
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">Recurring</div>
            <div className="docs-lifecycle-name">Plan subscriptions</div>
            <div className="docs-lifecycle-desc">
              Use <code>CheckoutModal</code>, on-chain plan state, smart-account
              setup, and subscription activation for recurring access.
            </div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">One-time</div>
            <div className="docs-lifecycle-name">Hosted payments</div>
            <div className="docs-lifecycle-desc">
              Use payment links and checkout sessions for standalone add-ons,
              invoice pay-now flows, and direct USDC collection.
            </div>
          </div>
        </div>

        <h2 id="contracts">Core contracts in the active runtime</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Contract</th><th>Role</th></tr>
          </thead>
          <tbody>
            {contracts.map(([name, description]) => (
              <tr key={name}>
                <td><code>{name}</code></td>
                <td>{description}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 id="request-flows">Main request flows</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Catalog and company data lives in Prisma</div>
              <p className="docs-step-desc">
                Plans, add-ons, payment links, checkout sessions, invoices, and
                feature rules are managed by the dashboard backend.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Subscriptions and proofs touch chain state</div>
              <p className="docs-step-desc">
                Subscription status is resolved from on-chain contracts and
                subgraph-backed reads; metered usage settles through the
                facilitator and proof contracts.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Hosted one-time payments verify direct transfers</div>
              <p className="docs-step-desc">
                A customer sends the exact Base Sepolia USDC amount, the backend
                verifies the transfer, records payment ledger rows, and then
                grants invoice or add-on effects.
              </p>
            </div>
          </div>
        </div>

        <h2 id="env-contract">Minimum environment contract</h2>
        <CodeBlock
          lang="env"
          code={`NEXT_PUBLIC_CHAIN_ID=84532
MEAP_DEFAULT_CHAIN_ID=84532
NEXT_PUBLIC_GRAPH_URL_84532=https://your-subgraph
FACILITATOR_BASE_URL_84532=http://localhost:3402
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
CHAIN_ID=84532`}
        />
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#architecture">Architecture</a></li>
          <li className="docs-toc-item"><a href="#system-overview">System overview</a></li>
          <li className="docs-toc-item"><a href="#billing-paths">Billing paths</a></li>
          <li className="docs-toc-item"><a href="#contracts">Core contracts</a></li>
          <li className="docs-toc-item"><a href="#request-flows">Request flows</a></li>
          <li className="docs-toc-item"><a href="#env-contract">Environment</a></li>
        </ul>
      </nav>
    </div>
  );
}
