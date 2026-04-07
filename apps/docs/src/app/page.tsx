export default function OverviewPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Introduction</div>

        <section className="docs-intro-hero" id="introduction">
          <div className="docs-intro-eyebrow">ArcenPay Documentation</div>
          <h1 className="docs-intro-title">
            Build subscription and usage billing for wallet-native products.
          </h1>
          <p className="docs-lead" style={{ marginBottom: 0 }}>
            ArcenPay combines recurring subscriptions, entitlement checks, and
            usage-based AI settlements into one protocol stack. If you are
            moving from Stripe-style billing, start with Quickstart, then follow
            the flow map below.
          </p>

          <div className="docs-intro-actions">
            <a href="/quickstart" className="docs-btn-primary">
              Start Quickstart
              <span>→</span>
            </a>
            <a
              href="/guides/migrate-from-stripe"
              className="docs-btn-secondary"
            >
              Migrating from Stripe?
            </a>
          </div>
        </section>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div>
            <strong>Testnet Live:</strong> All 7 contracts are deployed on
            Sepolia ETH (chainId 11155111). See{" "}
            <a href="/contract-addresses" style={{ color: "var(--accent)" }}>
              Contract Addresses
            </a>{" "}
            for deployment details.
          </div>
        </div>

        <h2 id="docs-flow">Docs flow</h2>
        <div className="docs-card-grid">
          <div className="docs-card">
            <div className="docs-card-kicker">Step 1</div>
            <h3 className="docs-card-title">Model your plans</h3>
            <p className="docs-card-text">
              Define your paid tiers and free baseline, then publish plans with
              on-chain IDs.
            </p>
            <a className="docs-card-link" href="/core-concepts/plans">
              Read plan modeling →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 2</div>
            <h3 className="docs-card-title">Integrate checkout</h3>
            <p className="docs-card-text">
              Add pricing UI, open checkout, and activate subscriptions through
              your backend.
            </p>
            <a className="docs-card-link" href="/features/checkout">
              Checkout integration →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 3</div>
            <h3 className="docs-card-title">Gate product access</h3>
            <p className="docs-card-text">
              Use feature flags and entitlement checks to enforce access in both
              frontend and server routes.
            </p>
            <a className="docs-card-link" href="/guides/feature-gating">
              Feature gating guide →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 4</div>
            <h3 className="docs-card-title">Operate and reconcile</h3>
            <p className="docs-card-text">
              Sync billing events, run webhooks, and keep customer portal state
              aligned with on-chain truth.
            </p>
            <a className="docs-card-link" href="/webhooks">
              Production operations →
            </a>
          </div>
        </div>

        <h2 id="why-arcenpay">Why ArcenPay?</h2>
        <p>
          ArcenPay provides two interconnected subsystems that cover both
          recurring subscriptions and metered AI workloads.
        </p>

        <ul>
          <li>
            <strong>ArcenPay Protocol</strong> — Automated recurring billing and
            cryptographic feature gating using ERC-7579 smart accounts and
            ERC-5643 subscription NFTs.
          </li>
          <li>
            <strong>ZKVUB</strong> (Zero-Knowledge Verifiable Usage Billing) —
            Metered, usage-based billing for AI agents using the x402 payment
            standard and Groth16 zk-SNARK proofs for trustless settlement.
          </li>
        </ul>

        <div className="docs-kpi-grid" id="at-a-glance">
          <div className="docs-kpi">
            <div className="docs-kpi-value">7</div>
            <div className="docs-kpi-label">
              Core contracts deployed on Sepolia
            </div>
          </div>
          <div className="docs-kpi">
            <div className="docs-kpi-value">2</div>
            <div className="docs-kpi-label">
              Billing modes: recurring and usage-based
            </div>
          </div>
          <div className="docs-kpi">
            <div className="docs-kpi-value">1</div>
            <div className="docs-kpi-label">
              Source of truth: on-chain state first
            </div>
          </div>
        </div>

        <h2 id="quick-install">Install the SDKs</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">bash</span>
          </div>
          <pre>
            <code>{`# React SDK (frontend)
npm install @arcenpay/react @arcenpay/sdk viem

# Node SDK (backend)
npm install @arcenpay/node

# Agent SDK (AI runtimes)
npm install @arcenpay/agent`}</code>
          </pre>
        </div>

        <h2 id="quick-example">Minimal integration snippet</h2>
        <p>
          This is the smallest practical shape for rendering plans and opening
          checkout from your app.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">TypeScript</span>
          </div>
          <pre>
            <code>{`import { ArcenPayProvider, PricingTable, CheckoutModal } from '@arcenpay/react';

function App() {
  return (
    <ArcenPayProvider
      planRegistryAddress="0x18707519A062AbCC3E73fBd4150C3B30B241f536"
      chainId={11155111}
    >
      <PricingTable
        planIds={[1, 2, 3]}
        onSelectPlan={(planId) => console.log('Selected:', planId)}
      />
      <CheckoutModal
        planId={1}
        onSuccess={(tx) => console.log('Subscribed!', tx)}
      />
    </ArcenPayProvider>
  );
}`}</code>
          </pre>
        </div>

        <h2 id="who-should-read">Who this docs set is for</h2>
        <ul>
          <li>
            <strong>Product engineers</strong> shipping wallet-native
            subscription flows
          </li>
          <li>
            <strong>Platform teams</strong> implementing entitlement checks and
            billing observability
          </li>
          <li>
            <strong>AI infra teams</strong> charging for metered calls via usage
            proofs
          </li>
        </ul>

        <h2 id="stack">Technology stack</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Layer</th>
              <th>Technology</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Chain</td>
              <td>Sepolia ETH (testnet) → Base (production)</td>
            </tr>
            <tr>
              <td>Smart Contracts</td>
              <td>Solidity 0.8.24</td>
            </tr>
            <tr>
              <td>Account Abstraction</td>
              <td>ERC-7579 (ZeroDev)</td>
            </tr>
            <tr>
              <td>Subscription NFT</td>
              <td>ERC-5643</td>
            </tr>
            <tr>
              <td>ZK Proofs</td>
              <td>Groth16 / Circom</td>
            </tr>
            <tr>
              <td>Machine Payments</td>
              <td>x402 Protocol</td>
            </tr>
            <tr>
              <td>Frontend</td>
              <td>React 19 + TypeScript</td>
            </tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc" aria-label="Table of contents">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active">
            <a href="#introduction">Introduction</a>
          </li>
          <li className="docs-toc-item">
            <a href="#docs-flow">Docs flow</a>
          </li>
          <li className="docs-toc-item">
            <a href="#why-arcenpay">Why ArcenPay?</a>
          </li>
          <li className="docs-toc-item">
            <a href="#at-a-glance">At a glance</a>
          </li>
          <li className="docs-toc-item">
            <a href="#quick-install">Quick install</a>
          </li>
          <li className="docs-toc-item">
            <a href="#quick-example">30-second example</a>
          </li>
          <li className="docs-toc-item">
            <a href="#who-should-read">Audience</a>
          </li>
          <li className="docs-toc-item">
            <a href="#stack">Technology stack</a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
