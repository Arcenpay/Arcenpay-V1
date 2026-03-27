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

export default function BillingFeesPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row"><h1>Billing & Fees</h1></div>

        <p className="docs-lead" id="billing-fees">
          The <strong>FeeCollector</strong> contract accumulates protocol fees from both subscription renewals (ArcenPay Protocol) and
          ZKVUB usage settlements. Fees are tier-dependent — providers on higher ArcenPay platform tiers pay lower rates.
        </p>

        <h2 id="fee-tiers">Fee tiers</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Provider tier</th><th>Subscription fee</th><th>ZKVUB settlement fee</th><th>How to qualify</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>FREE</strong></td><td>2.0% (200 bps)</td><td>1.0% (100 bps)</td><td>Default for all new providers</td></tr>
            <tr><td><strong>PLUS</strong></td><td>1.0% (100 bps)</td><td>0.5% (50 bps)</td><td>Contact sales or upgrade in dashboard</td></tr>
            <tr><td><strong>PRO</strong></td><td>0.5% (50 bps)</td><td>0.3% (30 bps)</td><td>Volume-based or enterprise contract</td></tr>
          </tbody>
        </table>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </span>
          <div>
            Fees are collected in the plan&apos;s <code>acceptedToken</code> (USDC). The protocol owner syncs a provider&apos;s tier via
            <code> FeeCollector.syncProviderTier(provider, tier)</code>. Custom overrides can be set per-provider.
          </div>
        </div>

        <h2 id="fee-constants">Fee constants</h2>
        <CodeBlock lang="Solidity" code={`// Default rates (overrideable per-provider)
uint256 public constant SUBSCRIPTION_FEE_BPS = 50;    // 0.5% (PRO default)
uint256 public constant SETTLEMENT_FEE_BPS   = 30;    // 0.3% (PRO default)
uint256 public constant BPS_DENOMINATOR      = 10_000;

// Platform tiers
uint8 public constant TIER_FREE = 0;
uint8 public constant TIER_PLUS = 1;
uint8 public constant TIER_PRO  = 2;`} />

        <h2 id="fee-collection">How fees are collected</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Billing contract calculates fee</div>
              <p className="docs-step-desc">AutopayModule (for subscriptions) calls <code>FeeCollector.collectSubscriptionFeeFor(amount, merchant)</code>. Returns <code>feeAmount</code> in basis points for that provider.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">USDC split on-chain</div>
              <p className="docs-step-desc"><code>merchantAmount = amount - feeAmount</code>. USDC is transferred to the merchant, then <code>feeAmount</code> is transferred to FeeCollector. <code>receiveFee(token, feeAmount)</code> increments accumulated balance.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Fees withdrawn to treasury</div>
              <p className="docs-step-desc">Protocol owner calls <code>FeeCollector.withdrawFees(usdcAddress)</code>. Entire accumulated balance is sent to the treasury address in one transaction.</p>
            </div>
          </div>
        </div>

        <h2 id="fee-collector-api">FeeCollector API</h2>
        <CodeBlock lang="Solidity" code={`// Returns the fee in USDC units for a subscription payment
function collectSubscriptionFee(uint256 amount) external returns (uint256 feeAmount);

// Provider-aware version (uses tier override if set)
function collectSubscriptionFeeFor(uint256 amount, address provider) external returns (uint256 feeAmount);

// Returns the fee for a ZKVUB settlement
function collectSettlementFee(uint256 amount) external returns (uint256 feeAmount);

// Provider-aware settlement fee
function collectSettlementFeeFor(uint256 amount, address provider) external returns (uint256 feeAmount);

// Accumulates received fee tokens
function receiveFee(address token, uint256 amount) external;

// Query total accumulated fees for a token
function accumulatedFees(address token) external view returns (uint256);

// Withdraw all accumulated fees to treasury (owner only)
function withdrawFees(address token) external;

// Query effective fee BPS for a provider
function getProviderSubFeeBps(address provider) external view returns (uint256);
function getProviderSettleFeeBps(address provider) external view returns (uint256);`} />

        <h2 id="fee-calculation-examples">Fee calculation examples</h2>
        <table className="docs-table">
          <thead><tr><th>Plan price</th><th>Provider tier</th><th>Fee BPS</th><th>Fee amount</th><th>Provider receives</th></tr></thead>
          <tbody>
            <tr><td>$10 USDC</td><td>FREE</td><td>200</td><td>$0.20</td><td>$9.80</td></tr>
            <tr><td>$10 USDC</td><td>PLUS</td><td>100</td><td>$0.10</td><td>$9.90</td></tr>
            <tr><td>$10 USDC</td><td>PRO</td><td>50</td><td>$0.05</td><td>$9.95</td></tr>
            <tr><td>$99 USDC</td><td>PRO</td><td>50</td><td>$0.495</td><td>$98.505</td></tr>
          </tbody>
        </table>

        <h2 id="custom-overrides">Custom provider overrides</h2>
        <p>The protocol owner can set custom fee rates for any provider — used for enterprise deals, legacy pricing, or referral bonuses:</p>
        <CodeBlock lang="Solidity" code={`// Set provider-specific rates (owner only)
// subFeeBps: subscription fee in basis points (max 1000 = 10%)
// settleFeeBps: settlement fee in basis points (max 1000 = 10%)
FeeCollector.setProviderFeeRates(
    address provider,
    uint256 subFeeBps,
    uint256 settleFeeBps
);

// Sync a provider to a platform tier (called on upgrade/downgrade)
FeeCollector.syncProviderTier(address provider, uint8 tier);`} />

        <h2 id="billing-events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>When emitted</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>FeeCollected</code></td><td>Every billing or settlement</td><td><code>collector, totalAmount, feeAmount, feeType</code></td></tr>
            <tr><td><code>FeesWithdrawn</code></td><td>Owner withdraws to treasury</td><td><code>treasury, amount</code></td></tr>
            <tr><td><code>ProviderFeeRateSet</code></td><td>Custom override set</td><td><code>provider, subFeeBps, settleFeeBps</code></td></tr>
            <tr><td><code>ProviderTierSynced</code></td><td>Provider tier upgraded/downgraded</td><td><code>provider, tier, subFeeBps, settleFeeBps</code></td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#billing-fees">Billing & Fees</a></li>
          <li className="docs-toc-item"><a href="#fee-tiers">Fee tiers</a></li>
          <li className="docs-toc-item"><a href="#fee-constants">Fee constants</a></li>
          <li className="docs-toc-item"><a href="#fee-collection">How fees are collected</a></li>
          <li className="docs-toc-item"><a href="#fee-collector-api">FeeCollector API</a></li>
          <li className="docs-toc-item"><a href="#fee-calculation-examples">Calculation examples</a></li>
          <li className="docs-toc-item"><a href="#custom-overrides">Custom overrides</a></li>
          <li className="docs-toc-item"><a href="#billing-events">Events</a></li>
        </ul>
      </nav>
    </div>
  );
}
