// ============================================================
//  Documentation — Home / Introduction Page
// ============================================================

export default function DocsHome() {
  return (
    <>
      <h1>Web3 Entitlement Layer</h1>
      <p style={{ fontSize: 18, color: '#a5b4fc', marginBottom: 32 }}>
        MEAP + ZKVUB Protocol — Decentralized billing and access framework for wallets, DAOs, and AI agents
      </p>

      <div className="callout info">
        <strong>Testnet Live:</strong> All 7 contracts are deployed on Sepolia ETH (chainId 11155111).
        See <a href="/contracts">Contract Reference</a> for addresses.
      </div>

      <h2>What is ArcenPay?</h2>
      <p>
        ArcenPay is a protocol-level decentralized billing and access control framework. It replaces
        legacy SaaS monetization infrastructure (Stripe + LaunchDarkly + SchematicHQ) with on-chain
        primitives designed for wallets, DAOs, AI agents, and multi-chain environments.
      </p>

      <h3>Two Interconnected Subsystems</h3>
      <ul>
        <li><strong>MEAP</strong> (Modular Entitlement and Access Protocol) — Automated recurring billing and cryptographic feature gating using ERC-7579 smart accounts and ERC-5643 subscription NFTs.</li>
        <li><strong>ZKVUB</strong> (Zero-Knowledge Verifiable Usage Billing) — Metered, usage-based billing for AI agents using the x402 payment standard and zk-SNARK proofs for trustless settlement.</li>
      </ul>

      <h2>Quick Install</h2>
      <pre><code>{`# React SDK (frontend)
npm install @meap/react @meap/core viem

# Node SDK (backend)
npm install @meap/node

# Agent SDK (AI runtimes)
npm install @meap/agent`}</code></pre>

      <h2>30-Second Example</h2>
      <pre><code>{`import { MEAPProvider, PricingTable, CheckoutModal } from '@meap/react';

function App() {
  return (
    <MEAPProvider
      planRegistryAddress="0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6"
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
    </MEAPProvider>
  );
}`}</code></pre>

      <h2>Target Users</h2>
      <ul>
        <li><strong>DAO Ops Leads</strong> — Multi-sig treasury payments, on-chain audit trails</li>
        <li><strong>Web3 App Developers</strong> — Token-gated features, subscription NFTs</li>
        <li><strong>AI Agent Runtimes</strong> — Autonomous x402 micropayments, zk-SNARK verified billing</li>
      </ul>

      <h2>Tech Stack</h2>
      <ul>
        <li><strong>Chain:</strong> Sepolia ETH (testnet) → Base (production)</li>
        <li><strong>Contracts:</strong> Solidity 0.8.24, Hardhat + Foundry</li>
        <li><strong>Account Abstraction:</strong> ERC-7579 (ZeroDev)</li>
        <li><strong>Subscription NFT:</strong> ERC-5643</li>
        <li><strong>Access Control:</strong> Lit Protocol (Phase 2)</li>
        <li><strong>Feature Flags:</strong> Tableland (Phase 2)</li>
        <li><strong>ZK Proofs:</strong> Groth16 / Circom (Phase 5)</li>
        <li><strong>Machine Payments:</strong> x402 Protocol</li>
      </ul>
    </>
  );
}
