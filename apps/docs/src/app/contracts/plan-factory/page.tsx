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

export default function PlanFactoryPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>PlanFactory</h1></div>

        <p className="docs-lead" id="plan-factory">
          <code>PlanFactory</code> is the entry point for providers. It stores on-chain plan definitions, manages provider registration,
          and maintains an allowlist of accepted stablecoins. All plans are immutable after creation — use <code>deactivatePlan()</code> and deploy a new plan to change pricing.
        </p>

        <h2 id="deployment">Deployment</h2>
        <table className="docs-table">
          <thead><tr><th>Network</th><th>Address</th><th>Chain ID</th></tr></thead>
          <tbody>
            <tr><td>Ethereum Sepolia</td><td><code>{getTestnetContractValue('planFactory', 11155111)}</code></td><td>11155111</td></tr>
            <tr><td>Base Sepolia</td><td><code>{getTestnetContractValue('planFactory', 84532)}</code></td><td>84532</td></tr>
          </tbody>
        </table>

        <h2 id="plan-struct">Plan struct</h2>
        <CodeBlock lang="Solidity" code={`struct Plan {
    uint256 id;              // Auto-incremented (starts at 1)
    address provider;        // Wallet that deployed the plan
    string  name;            // Human-readable name (e.g. "Pro Monthly")
    string  tier;            // SDK tier label (e.g. "pro")
    uint256 price;           // Price in USDC (6 decimals). $10 = 10_000_000
    uint32  billingInterval; // Seconds. Min 2,592,000 (30 days)
    address acceptedToken;   // USDC contract address
    bool    active;          // false after deactivatePlan()
    string  metadataURI;     // IPFS URI for extended metadata (optional)
}`} />

        <h2 id="functions">Functions</h2>

        <h3>createPlan</h3>
        <p>Deploys a new plan on-chain. Caller must be a registered provider. Returns the new <code>planId</code>.</p>
        <CodeBlock lang="Solidity" code={`function createPlan(
    string calldata name,
    string calldata tier,
    uint256 price,           // In USDC base units (6 decimals)
    uint32 billingInterval,  // In seconds. Must be >= 2,592,000
    address acceptedToken,   // Must be in approvedTokens list
    string calldata metadataURI
) external returns (uint256 planId);`} />

        <h3>getPlan</h3>
        <CodeBlock lang="Solidity" code={`function getPlan(uint256 planId) external view returns (Plan memory plan);`} />

        <h3>updatePlan</h3>
        <p>Updates price or metadataURI. Only the plan&apos;s provider can call this. All other fields are immutable.</p>
        <CodeBlock lang="Solidity" code={`function updatePlan(
    uint256 planId,
    uint256 price,           // Set to 0 to keep current price
    string calldata metadataURI  // Set to "" to keep current URI
) external;`} />

        <h3>deactivatePlan</h3>
        <p>Sets <code>plan.active = false</code>. No new subscriptions can be created. Existing subscriptions are unaffected.</p>
        <CodeBlock lang="Solidity" code={`function deactivatePlan(uint256 planId) external;`} />

        <h3>getProviderPlans</h3>
        <CodeBlock lang="Solidity" code={`function getProviderPlans(address provider) external view returns (uint256[] memory planIds);`} />

        <h3>isProvider</h3>
        <CodeBlock lang="Solidity" code={`function isProvider(address provider) external view returns (bool);`} />

        <h3>registerProvider (owner only)</h3>
        <CodeBlock lang="Solidity" code={`function registerProvider(address provider) external;`} />

        <h3>approveToken / revokeToken (owner only)</h3>
        <CodeBlock lang="Solidity" code={`function approveToken(address token) external;
function revokeToken(address token) external;`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>When emitted</th><th>Key fields</th></tr></thead>
          <tbody>
            <tr><td><code>PlanCreated</code></td><td>createPlan succeeds</td><td><code>planId, provider, name, price, billingInterval</code></td></tr>
            <tr><td><code>PlanUpdated</code></td><td>updatePlan succeeds</td><td><code>planId</code></td></tr>
            <tr><td><code>PlanDeactivated</code></td><td>deactivatePlan</td><td><code>planId</code></td></tr>
            <tr><td><code>ProviderRegistered</code></td><td>registerProvider</td><td><code>provider</code></td></tr>
          </tbody>
        </table>

        <h2 id="errors">Revert reasons</h2>
        <table className="docs-table">
          <thead><tr><th>Reason string</th><th>Cause</th></tr></thead>
          <tbody>
            <tr><td><code>PlanFactory: not a provider</code></td><td>Caller not registered as provider</td></tr>
            <tr><td><code>PlanFactory: price must be &gt; 0</code></td><td>price parameter is 0</td></tr>
            <tr><td><code>PlanFactory: interval must be &gt;= 30 days</code></td><td>billingInterval &lt; 2,592,000</td></tr>
            <tr><td><code>PlanFactory: token not approved</code></td><td>acceptedToken not in allowlist</td></tr>
            <tr><td><code>PlanFactory: plan not found</code></td><td>planId does not exist</td></tr>
            <tr><td><code>PlanFactory: not plan owner</code></td><td>Caller is not the plan&apos;s provider</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#plan-factory">PlanFactory</a></li>
          <li className="docs-toc-item"><a href="#deployment">Deployment</a></li>
          <li className="docs-toc-item"><a href="#plan-struct">Plan struct</a></li>
          <li className="docs-toc-item"><a href="#functions">Functions</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
          <li className="docs-toc-item"><a href="#errors">Revert reasons</a></li>
        </ul>
      </nav>
    </div>
  );
}
