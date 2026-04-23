'use client';
import { useState } from 'react';
import { getTestnetContractValue } from '@/lib/testnet-deployments';

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

export default function FeeCollectorPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>FeeCollector</h1></div>

        <p className="docs-lead" id="fee-collector">
          <code>FeeCollector</code> accumulates protocol fees from both ArcenPay subscription renewals and ZKVUB usage settlements.
          Fees are tier-dependent. The protocol owner withdraws accumulated USDC to the treasury via <code>withdrawFees(token)</code>.
        </p>

        <h2 id="deployment">Deployment</h2>
        <table className="docs-table">
          <thead><tr><th>Network</th><th>Address</th><th>Chain ID</th></tr></thead>
          <tbody>
            <tr><td>Ethereum Sepolia</td><td><code>{getTestnetContractValue('feeCollector', 11155111)}</code></td><td>11155111</td></tr>
            <tr><td>Base Sepolia</td><td><code>{getTestnetContractValue('feeCollector', 84532)}</code></td><td>84532</td></tr>
          </tbody>
        </table>

        <h2 id="fee-rates">Default fee rates</h2>
        <CodeBlock lang="Solidity" code={`// Default subscription rates by platform tier
tierSubFeeBps[TIER_FREE] = 200;   // 2.0%
tierSubFeeBps[TIER_PLUS] = 100;   // 1.0%
tierSubFeeBps[TIER_PRO]  = 50;    // 0.5%

// Default settlement rates (ZKVUB)
tierSettleFeeBps[TIER_FREE] = 100; // 1.0%
tierSettleFeeBps[TIER_PLUS] = 50;  // 0.5%
tierSettleFeeBps[TIER_PRO]  = 30;  // 0.3%

// Denominator
uint256 public constant BPS_DENOMINATOR = 10_000;`} />

        <h2 id="functions">Functions</h2>

        <h3>collectSubscriptionFee / collectSubscriptionFeeFor</h3>
        <CodeBlock lang="Solidity" code={`// Uses default SUBSCRIPTION_FEE_BPS (50)
function collectSubscriptionFee(uint256 amount) external returns (uint256 feeAmount);

// Uses provider-specific override if set, else default
function collectSubscriptionFeeFor(uint256 amount, address provider)
    external returns (uint256 feeAmount);`} />

        <h3>collectSettlementFee / collectSettlementFeeFor</h3>
        <CodeBlock lang="Solidity" code={`function collectSettlementFee(uint256 amount) external returns (uint256 feeAmount);
function collectSettlementFeeFor(uint256 amount, address provider)
    external returns (uint256 feeAmount);`} />

        <h3>receiveFee</h3>
        <CodeBlock lang="Solidity" code={`// Called by billing contracts after transferring fee tokens to this contract
function receiveFee(address token, uint256 amount) external;`} />

        <h3>accumulatedFees</h3>
        <CodeBlock lang="Solidity" code={`function accumulatedFees(address token) external view returns (uint256);`} />

        <h3>withdrawFees (owner only)</h3>
        <CodeBlock lang="Solidity" code={`// Sends all accumulated fees for a token to the treasury
function withdrawFees(address token) external;`} />

        <h3>getProviderSubFeeBps / getProviderSettleFeeBps</h3>
        <CodeBlock lang="Solidity" code={`function getProviderSubFeeBps(address provider) external view returns (uint256);
function getProviderSettleFeeBps(address provider) external view returns (uint256);`} />

        <h3>Admin functions</h3>
        <CodeBlock lang="Solidity" code={`function setTreasury(address _treasury) external;
function authorizeCollector(address collector) external;
function revokeCollector(address collector) external;
function setProviderFeeRates(address provider, uint256 subFeeBps, uint256 settleFeeBps) external;
function syncProviderTier(address provider, uint8 tier) external;
function setTierFeeRates(uint8 tier, uint256 subFeeBps, uint256 settleFeeBps) external;`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>When</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>FeeCollected</code></td><td>Any billing or settlement</td><td><code>collector, totalAmount, feeAmount, feeType</code></td></tr>
            <tr><td><code>FeesWithdrawn</code></td><td>withdrawFees()</td><td><code>treasury, amount</code></td></tr>
            <tr><td><code>ProviderFeeRateSet</code></td><td>setProviderFeeRates()</td><td><code>provider, subFeeBps, settleFeeBps</code></td></tr>
            <tr><td><code>ProviderTierSynced</code></td><td>syncProviderTier()</td><td><code>provider, tier, subFeeBps, settleFeeBps</code></td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#fee-collector">FeeCollector</a></li>
          <li className="docs-toc-item"><a href="#deployment">Deployment</a></li>
          <li className="docs-toc-item"><a href="#fee-rates">Fee rates</a></li>
          <li className="docs-toc-item"><a href="#functions">Functions</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
        </ul>
      </nav>
    </div>
  );
}
