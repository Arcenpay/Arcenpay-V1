'use client';
import { useState } from 'react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button className="docs-codeblock-copy" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function MigrationPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Introduction</div>
        <div className="docs-page-title-row"><h1>Migration Guide</h1></div>

        <p className="docs-lead" id="migration">
          Moving from a traditional Web2 billing system (like Stripe or Chargebee) to ArcenPay involves shifting from 
          centralized ledger state to decentralized on-chain subscription NFTs.
        </p>

        <h2 id="key-differences">Key differences</h2>
        <table className="docs-table">
          <thead><tr><th>Concept</th><th>Stripe / Web2</th><th>ArcenPay / Web3</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Identity</strong></td>
              <td>Email / Customer ID</td>
              <td>Wallet Address (EOA or Smart Account)</td>
            </tr>
            <tr>
              <td><strong>Payment Method</strong></td>
              <td>Credit Card / ACH</td>
              <td>ERC-20 Tokens (USDC/USDT)</td>
            </tr>
            <tr>
              <td><strong>Billing Logic</strong></td>
              <td>Stripe Servers</td>
              <td>Smart Contracts (ERC-5643)</td>
            </tr>
            <tr>
              <td><strong>Access Control</strong></td>
              <td>DB Check / API Call</td>
              <td>NFT Ownership / On-chain query</td>
            </tr>
            <tr>
              <td><strong>Funding</strong></td>
              <td>Pull (Pre-auth)</td>
              <td>Push (Pre-funded) or Smart Account Pull</td>
            </tr>
          </tbody>
        </table>

        <h2 id="migration-strategies">Migration strategies</h2>
        
        <h3>1. The "Clean Break" (Recommended)</h3>
        <p>
          Let existing legacy subscriptions expire in your old system. Direct all <strong>new</strong> customers to 
          ArcenPay. This avoids the complexity of migrating payment methods which is impossible for crypto.
        </p>

        <h3>2. The Parallel Run</h3>
        <p>
          Support both systems simultaneously. Use the ArcenPay SDK&apos;s <code>useSubscription</code> hook alongside 
          your existing Stripe database checks.
        </p>
        <CodeBlock lang="typescript" code={`function useUserAccess() {
  const { status: web3Status } = useSubscription();
  const { data: web2Status } = useStripeSubscription(); // Your logic

  return web3Status === 'active' || web2Status === 'active';
}`} />

        <h2 id="technical-steps">Technical steps</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Map your products to Plans</div>
              <p className="docs-step-desc">
                Create ArcenPay <code>Plans</code> that match your Stripe <code>Price</code> IDs. Ensure the billing
                intervals (e.g., 30 days) and prices are consistent.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Install ArcenPay SDKs</div>
              <p className="docs-step-desc">
                Replace your Stripe.js integration with <code>@arcenpay/react</code>. Wrap your app in <code>ArcenPayProvider</code>.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Update Gating Logic</div>
              <p className="docs-step-desc">
                Instead of checking a `customers` table in SQL, check for an active NFT on-chain using 
                <code>registry.hasActiveSubscription(wallet)</code>.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Setup Webhooks</div>
              <p className="docs-step-desc">
                Configuring ArcenPay webhooks to sync on-chain renewals to your existing database for analytics and 
                customer support.
              </p>
            </div>
          </div>
        </div>

        <h2 id="data-migration">Data migration</h2>
        <p>
          Since ArcenPay uses NFTs, you can <strong>airdrop</strong> subscriptions to your best customers.
          Call <code>SubscriptionRegistry.mint(wallet, planId, duration)</code> from your provider wallet to 
          gift free access periods during the migration.
        </p>

        <div className="docs-callout tip">
          <span className="docs-callout-icon">💡</span>
          <div>
            Need help with a large-scale migration? Our engineering team provides custom scripts for bridging
            large user bases. <a href="/support">Contact Support</a>.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#migration">Migration Guide</a></li>
          <li className="docs-toc-item"><a href="#key-differences">Key differences</a></li>
          <li className="docs-toc-item"><a href="#migration-strategies">Strategies</a></li>
          <li className="docs-toc-item"><a href="#technical-steps">Technical steps</a></li>
          <li className="docs-toc-item"><a href="#data-migration">Data migration</a></li>
        </ul>
      </nav>
    </div>
  );
}
