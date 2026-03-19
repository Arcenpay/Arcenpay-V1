'use client';
import { useState } from 'react';

function CopyIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button className="docs-codeblock-copy" onClick={handleCopy}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function CopyPageButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <button className="docs-copy-btn" onClick={handleCopy}>
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? 'Copied!' : 'Copy page'}
    </button>
  );
}

const CREATE_PLAN_CODE = `function createPlan(
    string calldata name,
    string calldata tier,
    uint256 price,
    uint32 billingInterval,
    address acceptedToken,
    string calldata metadataURI
) external returns (uint256 planId)`;

const PLAN_STRUCT_CODE = `struct Plan {
    uint256 id;           // Auto-incremented plan ID
    address provider;     // Address that deployed the plan
    string  name;         // Human-readable plan name
    string  tier;         // Tier label (e.g. "pro", "enterprise")
    uint256 price;        // Price in USDC (6-decimal units)
    uint32  billingInterval; // Seconds between billing cycles
    address acceptedToken;   // Approved USDC token contract
    bool    active;       // Whether the plan is live
    string  metadataURI;  // IPFS URI for plan metadata
}`;

export default function PlansPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      {/* ── Main article ── */}
      <article className="docs-article">

        {/* Breadcrumb + title row */}
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row">
          <h1>Plans</h1>
          <CopyPageButton />
        </div>

        {/* Lead */}
        <p className="docs-lead" id="plans">
          A plan is an on-chain struct stored in <strong>PlanFactory</strong>. It defines the name, tier, USDC price,
          billing interval, and the accepted token address. Plans are immutable once created —
          archive and redeploy to change pricing.
        </p>

        {/* ── Creating a plan ── */}
        <h2 id="creating-a-plan">Creating a plan</h2>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Open the Plans section</div>
              <p className="docs-step-desc">
                Navigate to <strong>Catalog → Plans</strong> in the sidebar and click <strong>Create Plan</strong>.
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Fill in plan details</div>
              <p className="docs-step-desc">
                Enter a plan name (e.g. <code>Pro</code>), a USDC price, and choose a billing interval:
                Monthly (30d), Quarterly (90d), or Annual (365d).
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Select the accepted token</div>
              <p className="docs-step-desc">
                Choose the USDC contract for the chain your subscribers will pay on. Sepolia, Base Sepolia,
                and Base Mainnet USDC addresses are pre-filled.
              </p>
            </div>
          </div>

          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Deploy on-chain</div>
              <p className="docs-step-desc">
                Click <strong>Deploy Plan</strong>. Your wallet will prompt a transaction calling{' '}
                <code>PlanFactory.createPlan()</code>. Estimated gas: ~120,000 units.
              </p>
            </div>
          </div>
        </div>

        {/* ── Contract call signature ── */}
        <h2 id="contract-call-signature">Contract call signature</h2>
        <p>Calling <code>createPlan</code> directly from your own contract or deployer script:</p>
        <CodeBlock lang="Solidity" code={CREATE_PLAN_CODE} />

        <h3>Parameters</h3>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>name</code></td>
              <td><code>string</code></td>
              <td>Human-readable plan name shown in UI (e.g. &ldquo;Pro&rdquo;)</td>
            </tr>
            <tr>
              <td><code>tier</code></td>
              <td><code>string</code></td>
              <td>Internal tier label used by SDK gating (e.g. &ldquo;pro&rdquo;)</td>
            </tr>
            <tr>
              <td><code>price</code></td>
              <td><code>uint256</code></td>
              <td>Price in USDC with 6 decimals (e.g. <code>10_000_000</code> = $10)</td>
            </tr>
            <tr>
              <td><code>billingInterval</code></td>
              <td><code>uint32</code></td>
              <td>Seconds between billing cycles. Minimum 2,592,000 (30 days)</td>
            </tr>
            <tr>
              <td><code>acceptedToken</code></td>
              <td><code>address</code></td>
              <td>Approved USDC token contract address for the target chain</td>
            </tr>
            <tr>
              <td><code>metadataURI</code></td>
              <td><code>string</code></td>
              <td>IPFS URI containing extended plan metadata (optional)</td>
            </tr>
          </tbody>
        </table>

        {/* ── Plan struct ── */}
        <h3>Plan struct</h3>
        <CodeBlock lang="Solidity" code={PLAN_STRUCT_CODE} />

        {/* ── Plan lifecycle ── */}
        <h2 id="plan-lifecycle">Plan lifecycle</h2>
        <p>Plans move through two lifecycle states on-chain:</p>

        <div className="docs-lifecycle">
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Active
            </div>
            <div className="docs-lifecycle-name">Live plan</div>
            <div className="docs-lifecycle-desc">
              Subscribers can subscribe. AutopayModule will pull USDC on each billing interval.
            </div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge archived">Archived</div>
            <div className="docs-lifecycle-name">Deactivated</div>
            <div className="docs-lifecycle-desc">
              New subscriptions blocked. Existing subscribers remain active until their period expires.
            </div>
          </div>
        </div>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div>
            Plans are <strong>immutable</strong> once deployed. To change pricing, deactivate the existing plan
            via <code>deactivatePlan(planId)</code> and create a new one with the updated parameters.
          </div>
        </div>

        {/* ── Gas estimates ── */}
        <h2 id="gas-estimates">Gas estimates</h2>
        <table className="docs-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Function</th>
              <th>Estimated Gas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Create plan</td>
              <td><code>createPlan()</code></td>
              <td>~120,000 units</td>
            </tr>
            <tr>
              <td>Deactivate plan</td>
              <td><code>deactivatePlan()</code></td>
              <td>~28,000 units</td>
            </tr>
            <tr>
              <td>Read plan</td>
              <td><code>getPlan()</code></td>
              <td>Free (view)</td>
            </tr>
          </tbody>
        </table>

      </article>

      {/* ── Right TOC ── */}
      <nav className="docs-toc" aria-label="Table of contents">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#plans">Plans</a></li>
          <li className="docs-toc-item"><a href="#creating-a-plan">Creating a plan</a></li>
          <li className="docs-toc-item"><a href="#contract-call-signature">Contract call signature</a></li>
          <li className="docs-toc-item"><a href="#plan-lifecycle">Plan lifecycle</a></li>
          <li className="docs-toc-item"><a href="#gas-estimates">Gas estimates</a></li>
        </ul>
      </nav>
    </div>
  );
}
