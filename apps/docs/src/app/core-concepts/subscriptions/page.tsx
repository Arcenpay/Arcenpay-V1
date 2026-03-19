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

export default function SubscriptionsPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row">
          <h1>Subscriptions</h1>
        </div>

        <p className="docs-lead" id="subscriptions">
          A subscription is an <strong>ERC-5643</strong> NFT minted by the <code>SubscriptionRegistry</code> when
          a subscriber completes checkout. Each NFT records the plan ID, expiry timestamp, and wallet address.
          Access is valid as long as <code>expiresAt(tokenId) &gt; block.timestamp</code>.
        </p>

        <h2 id="lifecycle">Lifecycle</h2>

        <div className="docs-lifecycle">
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
              Active
            </div>
            <div className="docs-lifecycle-name">Subscribed</div>
            <div className="docs-lifecycle-desc">NFT minted, <code>expiresAt</code> set to <code>now + billingInterval</code>. AutopayModule will renew automatically.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge" style={{ background:'rgba(234,179,8,0.1)', color:'#92400e', border: '1px solid rgba(234,179,8,0.2)' }}>Renewing</div>
            <div className="docs-lifecycle-name">Auto-renewed</div>
            <div className="docs-lifecycle-desc">On each billing cycle, AutopayModule pulls USDC and calls <code>renew(tokenId, duration)</code>.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge archived">Expired</div>
            <div className="docs-lifecycle-name">Cancelled / Expired</div>
            <div className="docs-lifecycle-desc">Subscriber or biller calls <code>cancel()</code>. Expiry set to <code>now</code>. NFT remains but access is revoked.</div>
          </div>
        </div>

        <h2 id="contract-interface">SubscriptionRegistry interface</h2>
        <p>The <code>SubscriptionRegistry</code> extends <strong>ERC-721</strong> with ERC-5643 subscription logic. One active token per wallet per registry.</p>

        <CodeBlock lang="Solidity" code={`// Mint a new subscription NFT (called by AutopayModule)
function mint(
    address to,
    uint256 planId,
    uint64 duration          // seconds
) external returns (uint256 tokenId);

// Extend an existing subscription
function renew(
    uint256 tokenId,
    uint64 extension         // seconds to add
) external;

// Cancel immediately — sets expiresAt to now
function cancel(uint256 tokenId) external;

// ERC-5643: returns expiry timestamp (Unix seconds)
function expiresAt(uint256 tokenId) external view returns (uint64);

// Returns true if tokenId exists and not expired
function isValid(uint256 tokenId) external view returns (bool);

// Fast lookup: wallet → active tokenId (0 if none)
function getWalletSubscription(address wallet) external view returns (uint256);

// Returns true if wallet has valid subscription right now
function hasActiveSubscription(address wallet) external view returns (bool);`} />

        <h2 id="checking-access">Checking access on-chain</h2>
        <p>Gate any function with a single view call:</p>
        <CodeBlock lang="Solidity" code={`import { ISubscriptionRegistry } from "@arcenpay/contracts/interfaces/ISubscriptionRegistry.sol";

contract MyGatedFeature {
    ISubscriptionRegistry public registry;

    modifier onlySubscriber() {
        require(
            registry.hasActiveSubscription(msg.sender),
            "Subscription required"
        );
        _;
    }

    function premiumAction() external onlySubscriber {
        // ...
    }
}`} />

        <h2 id="checking-access-react">Checking access in React</h2>
        <CodeBlock lang="TypeScript" code={`import { useSubscription } from '@meap/react';

function PremiumFeature() {
  const { isActive, expiresAt, tokenId, isLoading } = useSubscription();

  if (isLoading) return <Spinner />;
  if (!isActive) return <UpgradePrompt />;

  return (
    <div>
      <p>Access valid until: {new Date(expiresAt * 1000).toLocaleDateString()}</p>
      <p>Token ID: #{tokenId}</p>
      {/* Your premium content */}
    </div>
  );
}`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>Emitted when</th><th>Key fields</th></tr></thead>
          <tbody>
            <tr><td><code>SubscriptionMinted</code></td><td>NFT created on first checkout</td><td><code>to, tokenId, planId, expiration</code></td></tr>
            <tr><td><code>SubscriptionUpdate</code></td><td>Renewal or cancellation</td><td><code>tokenId, newExpiration</code></td></tr>
            <tr><td><code>SubscriptionRenewed</code></td><td>AutopayModule renews</td><td><code>tokenId, newExpiration, amount</code></td></tr>
            <tr><td><code>SubscriptionCancelled</code></td><td>Cancel call succeeds</td><td><code>tokenId</code></td></tr>
          </tbody>
        </table>

        <h2 id="cross-chain">Cross-chain state</h2>
        <p>
          After each renewal, <code>SubscriptionRegistry</code> can dispatch a <strong>General Message Passing (GMP)</strong> payload
          to a <code>MirrorRegistry</code> on any destination chain. The payload encodes the owner, tokenId, planId, tier, and new expiry.
        </p>
        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </span>
          <div>
            Cross-chain dispatch uses <strong>Axelar GMP</strong> as primary and <strong>Chainlink CCIP</strong> as fallback. 
            If the primary fails, the payment is <em>not</em> reverted — a <code>CrossChainFallbackTriggered</code> event is emitted instead.
          </div>
        </div>

        <h2 id="cancellation">Cancelling a subscription</h2>
        <p>The subscriber can cancel directly by calling <code>cancelSubscription(tokenId)</code> from their wallet. The biller can also call <code>cancel(tokenId)</code>. In both cases, <code>expiresAt</code> is immediately set to the current block timestamp.</p>
        <div className="docs-callout warning">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </span>
          <div>
            Cancellation does <strong>not</strong> issue a refund for the current billing period. There is no grace period — 
            access is revoked immediately at the block level.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#subscriptions">Subscriptions</a></li>
          <li className="docs-toc-item"><a href="#lifecycle">Lifecycle</a></li>
          <li className="docs-toc-item"><a href="#contract-interface">Contract interface</a></li>
          <li className="docs-toc-item"><a href="#checking-access">Checking access on-chain</a></li>
          <li className="docs-toc-item"><a href="#checking-access-react">Checking access in React</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
          <li className="docs-toc-item"><a href="#cross-chain">Cross-chain state</a></li>
          <li className="docs-toc-item"><a href="#cancellation">Cancellation</a></li>
        </ul>
      </nav>
    </div>
  );
}
