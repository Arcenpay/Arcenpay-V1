export default function OverviewPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row">
          <h1>Overview</h1>
        </div>

        <p className="docs-lead">
          ArcenPay is a protocol-level decentralized billing and access control framework. It replaces
          legacy SaaS monetization (Stripe + LaunchDarkly + SchematicHQ) with on-chain primitives
          designed for wallets, DAOs, AI agents, and multi-chain environments.
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div>
            <strong>Testnet Live:</strong> All 7 contracts are deployed on Sepolia ETH (chainId 11155111).
            See <a href="/contract-addresses" style={{ color: 'var(--accent)' }}>Contract Addresses</a> for deployment details.
          </div>
        </div>

        <h2 id="what-is-arcenpay">What is ArcenPay?</h2>
        <p>
          ArcenPay provides two interconnected on-chain subsystems that together cover the full
          spectrum of billing — from recurring human subscriptions to metered AI agent micropayments.
        </p>

        <ul>
          <li>
            <strong>ArcenPay Protocol</strong> — Automated recurring
            billing and cryptographic feature gating using ERC-7579 smart accounts and ERC-5643
            subscription NFTs.
          </li>
          <li>
            <strong>ZKVUB</strong> (Zero-Knowledge Verifiable Usage Billing) — Metered, usage-based
            billing for AI agents using the x402 payment standard and Groth16 zk-SNARK proofs for
            trustless settlement.
          </li>
        </ul>

        <h2 id="quick-install">Quick install</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">bash</span>
          </div>
          <pre><code>{`# React SDK (frontend)
npm install @arcenpay/react @arcenpay/sdk viem

# Node SDK (backend)
npm install @arcenpay/node

# Agent SDK (AI runtimes)
npm install @arcenpay/agent`}</code></pre>
        </div>

        <h2 id="quick-example">30-second example</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">TypeScript</span>
          </div>
          <pre><code>{`import { ArcenPayProvider, PricingTable, CheckoutModal } from '@arcenpay/react';

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
}`}</code></pre>
        </div>

        <h2 id="target-users">Target users</h2>
        <ul>
          <li><strong>DAO Ops Leads</strong> — Multi-sig treasury payments, on-chain audit trails</li>
          <li><strong>Web3 App Developers</strong> — Token-gated features, subscription NFTs</li>
          <li><strong>AI Agent Runtimes</strong> — Autonomous x402 micropayments, zk-SNARK verified billing</li>
        </ul>

        <h2 id="technology-stack">Technology stack</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Layer</th><th>Technology</th></tr>
          </thead>
          <tbody>
            <tr><td>Chain</td><td>Sepolia ETH (testnet) → Base (production)</td></tr>
            <tr><td>Smart Contracts</td><td>Solidity 0.8.24</td></tr>
            <tr><td>Account Abstraction</td><td>ERC-7579 (ZeroDev)</td></tr>
            <tr><td>Subscription NFT</td><td>ERC-5643</td></tr>
            <tr><td>ZK Proofs</td><td>Groth16 / Circom</td></tr>
            <tr><td>Machine Payments</td><td>x402 Protocol</td></tr>
            <tr><td>Frontend</td><td>React 19 + TypeScript</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc" aria-label="Table of contents">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#what-is-arcenpay">What is ArcenPay?</a></li>
          <li className="docs-toc-item"><a href="#quick-install">Quick install</a></li>
          <li className="docs-toc-item"><a href="#quick-example">30-second example</a></li>
          <li className="docs-toc-item"><a href="#target-users">Target users</a></li>
          <li className="docs-toc-item"><a href="#technology-stack">Technology stack</a></li>
        </ul>
      </nav>
    </div>
  );
}
