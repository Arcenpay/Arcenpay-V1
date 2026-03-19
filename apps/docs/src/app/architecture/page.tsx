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

export default function ArchitecturePage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row"><h1>Architecture</h1></div>

        <p className="docs-lead" id="architecture">
          ArcenPay is a two-subsystem protocol. <strong>MEAP</strong> handles structured recurring billing for humans
          and organizations; <strong>ZKVUB</strong> handles metered AI agent micropayments with cryptographic proof of usage.
          Both subsystems share the same <code>PlanFactory</code> and <code>FeeCollector</code> primitives.
        </p>

        <h2 id="system-overview">System overview</h2>
        <table className="docs-table">
          <thead><tr><th>Subsystem</th><th>Stands for</th><th>Use case</th><th>Key contracts</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>MEAP</strong></td>
              <td>Modular Entitlement & Access Protocol</td>
              <td>Recurring subscriptions, feature gating</td>
              <td>PlanFactory, SubscriptionRegistry, ERC7579AutopayModule</td>
            </tr>
            <tr>
              <td><strong>ZKVUB</strong></td>
              <td>Zero-Knowledge Verifiable Usage Billing</td>
              <td>Metered API calls, AI agent payments</td>
              <td>SessionVault, ZKUsageVerifier</td>
            </tr>
          </tbody>
        </table>

        <h2 id="contract-map">Contract map</h2>
        <p>Seven contracts form the protocol core. All are deployed on Sepolia ETH (chainId 11155111).</p>
        <div className="docs-lifecycle" style={{ marginBottom: 32 }}>
          {[
            { name: 'PlanFactory', desc: 'Creates and manages on-chain subscription plans. One plan per tier. Immutable after creation. Registers providers.', color: '#6366f1' },
            { name: 'SubscriptionRegistry', desc: 'ERC-721 + ERC-5643 NFT contract. Mints, renews, and cancels subscription tokens. One active token per wallet.', color: '#8b5cf6' },
            { name: 'ERC7579AutopayModule', desc: 'ERC-7579 executor module installed on subscriber\'s smart account. Pulls USDC on each billing interval. Calls SubscriptionRegistry.renew().', color: '#a78bfa' },
            { name: 'SessionVault', desc: 'Pre-funded stablecoin vault for ZKVUB sessions. Agents deposit USDC; ZKUsageVerifier settles from the balance.', color: '#0ea5e9' },
            { name: 'ZKUsageVerifier', desc: 'Verifies Groth16 zk-SNARK proofs and executes USDC settlement from SessionVault. Nullifier prevents double-spend.', color: '#06b6d4' },
            { name: 'FeeCollector', desc: 'Protocol-level fee collection. 0.5% on subscriptions, 0.3% on ZKVUB settlements. Per-provider tier overrides.', color: '#10b981' },
            { name: 'MirrorRegistry', desc: 'Cross-chain subscription state mirror. Receives ABI-encoded GMP payloads via Axelar (primary) or CCIP (fallback). Enables multi-chain gating.', color: '#f59e0b' },
          ].map(({ name, desc, color }) => (
            <div key={name} className="docs-lifecycle-item" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 16 }}>
              <div className="docs-lifecycle-name" style={{ color, fontFamily: 'monospace', fontSize: 13 }}>{name}</div>
              <div className="docs-lifecycle-desc" style={{ marginTop: 4 }}>{desc}</div>
            </div>
          ))}
        </div>

        <h2 id="meap-flow">MEAP: recurring billing flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Provider deploys a plan</div>
              <p className="docs-step-desc">Calls <code>PlanFactory.createPlan()</code> with name, tier, price (USDC), and billing interval (≥30 days). Returns a unique <code>planId</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Subscriber installs AutopayModule</div>
              <p className="docs-step-desc">Subscriber&apos;s ERC-7579 smart account calls <code>AutopayModule.onInstall(AutopayConfig)</code>. The module receives limited pull-payment authority — constrained to <code>maxAmount</code> per <code>interval</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Provider triggers billing</div>
              <p className="docs-step-desc">Provider (or a bot) calls <code>AutopayModule.execute(account, amount)</code>. The module verifies interval, pulls USDC, deducts protocol fee via <code>FeeCollector</code>, and renews the subscription NFT.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Access validated</div>
              <p className="docs-step-desc">Any gated function calls <code>SubscriptionRegistry.hasActiveSubscription(wallet)</code>. Returns <code>true</code> while the NFT expiry is in the future.</p>
            </div>
          </div>
        </div>

        <h2 id="zkvub-flow">ZKVUB: metered billing flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Agent funds a session</div>
              <p className="docs-step-desc"><code>SessionVault.fundSession(amount, usdcAddress)</code> — transfers USDC into the vault and returns a <code>sessionId</code> (bytes32).</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Agent makes API calls</div>
              <p className="docs-step-desc">Uses x402 HTTP payment headers. Each call is signed and logged off-chain by a Facilitator node. The agent&apos;s session balance acts as a spending limit.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Groth16 proof generated</div>
              <p className="docs-step-desc">A Circom circuit computes a zk-SNARK proof over the merkle root of signed request logs. The proof attests to <code>callCount</code> without revealing individual request data.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">On-chain settlement</div>
              <p className="docs-step-desc"><code>ZKUsageVerifier.submitProof()</code> verifies the proof, calculates <code>callCount × ratePerCall</code>, and calls <code>SessionVault.settle()</code>. Nullifier prevents double-spend.</p>
            </div>
          </div>
        </div>

        <h2 id="cross-chain">Cross-chain architecture</h2>
        <p>Subscription state can be mirrored to any EVM chain via <strong>General Message Passing (GMP)</strong>:</p>
        <table className="docs-table">
          <thead><tr><th>Route</th><th>Protocol</th><th>Priority</th><th>Fallback</th></tr></thead>
          <tbody>
            <tr><td>Primary</td><td>Axelar GMP</td><td>1st attempt</td><td>Falls back to CCIP on failure</td></tr>
            <tr><td>Fallback</td><td>Chainlink CCIP</td><td>2nd attempt</td><td>Reverts if both fail</td></tr>
          </tbody>
        </table>
        <p>
          The <code>SubscriptionRegistry</code> on the source chain calls <code>dispatchCrossChainUpdate()</code> after each renewal.
          The <code>MirrorRegistry</code> on the destination chain receives the ABI-encoded payload via <code>onAxelarMessage()</code> or <code>onCCIPMessage()</code>.
        </p>

        <h2 id="account-abstraction">Account abstraction</h2>
        <p>
          MEAP uses ERC-7579 (the modular smart account standard) for subscribers. This means:
        </p>
        <ul>
          <li>Subscribers can pay gas in USDC (using a Paymaster)</li>
          <li>The AutopayModule has <em>constrained</em> authority — it can only pull the exact plan amount, once per billing interval</li>
          <li>ERC-4337 bundlers trigger billing transactions, enabling gasless UX</li>
          <li>Subscribers can uninstall the module at any time to cancel</li>
        </ul>

        <h2 id="fee-model">Fee model</h2>
        <table className="docs-table">
          <thead><tr><th>Provider tier</th><th>Subscription fee</th><th>Settlement fee</th></tr></thead>
          <tbody>
            <tr><td>FREE</td><td>2.0% (200 bps)</td><td>1.0% (100 bps)</td></tr>
            <tr><td>PLUS</td><td>1.0% (100 bps)</td><td>0.5% (50 bps)</td></tr>
            <tr><td>PRO</td><td>0.5% (50 bps)</td><td>0.3% (30 bps)</td></tr>
          </tbody>
        </table>
        <p>Fees are collected by <code>FeeCollector</code> and accumulated as USDC. The protocol owner withdraws fees to the treasury via <code>withdrawFees(token)</code>.</p>

        <h2 id="security">Security model</h2>
        <ul>
          <li><strong>Reentrancy:</strong> All mutating functions use OpenZeppelin <code>ReentrancyGuard</code></li>
          <li><strong>Access control:</strong> Ownable pattern. Billers, settlers, and bridges must be explicitly authorized by the owner</li>
          <li><strong>Nullifiers:</strong> ZKUsageVerifier stores used nullifiers to prevent double-spend attacks</li>
          <li><strong>Amount limits:</strong> AutopayModule enforces <code>maxAmount ≤ plan.price</code> and minimum 30-day intervals</li>
          <li><strong>Token allowlist:</strong> PlanFactory only accepts pre-approved stablecoin addresses</li>
        </ul>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#architecture">Architecture</a></li>
          <li className="docs-toc-item"><a href="#system-overview">System overview</a></li>
          <li className="docs-toc-item"><a href="#contract-map">Contract map</a></li>
          <li className="docs-toc-item"><a href="#meap-flow">MEAP billing flow</a></li>
          <li className="docs-toc-item"><a href="#zkvub-flow">ZKVUB metered flow</a></li>
          <li className="docs-toc-item"><a href="#cross-chain">Cross-chain</a></li>
          <li className="docs-toc-item"><a href="#account-abstraction">Account abstraction</a></li>
          <li className="docs-toc-item"><a href="#fee-model">Fee model</a></li>
          <li className="docs-toc-item"><a href="#security">Security model</a></li>
        </ul>
      </nav>
    </div>
  );
}
