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

export default function CrossChainPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row"><h1>Cross-Chain</h1></div>

        <p className="docs-lead" id="cross-chain">
          ArcenPay can mirror subscription state to any EVM-compatible chain using <strong>General Message Passing (GMP)</strong>.
          A subscription minted on Sepolia can be verified on Base, Arbitrum, or Polygon within one block confirmation — 
          without requiring users to bridge tokens or re-subscribe on each chain.
        </p>

        <h2 id="how-it-works">How cross-chain works</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Billing occurs on source chain</div>
              <p className="docs-step-desc">AutopayModule renews a subscription NFT on Sepolia (source). <code>SubscriptionRegistry</code> builds an ABI-encoded payload: <code>abi.encode(owner, tokenId, planId, planTier, expiration, updatedAt)</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Dispatch via GMP</div>
              <p className="docs-step-desc"><code>SubscriptionRegistry.dispatchCrossChainUpdate(tokenId, destinationChainId, refundAddress)</code> tries Axelar first. If the Axelar call fails, it falls back to Chainlink CCIP. If both fail, the payment is <em>not</em> reverted.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">MirrorRegistry receives update</div>
              <p className="docs-step-desc">On the destination chain, <code>MirrorRegistry.onAxelarMessage()</code> or <code>onCCIPMessage()</code> processes the payload. The router verifies the trusted source hash before applying the update.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Access gating on destination chain</div>
              <p className="docs-step-desc">Your contract on the destination chain calls <code>MirrorRegistry.isValid(wallet)</code>. Returns <code>true</code> if <code>expiration &gt; block.timestamp</code>.</p>
            </div>
          </div>
        </div>

        <h2 id="transport-routes">Transport routes</h2>
        <table className="docs-table">
          <thead><tr><th>Route</th><th>Protocol</th><th>Priority</th><th>Notes</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Primary</strong></td>
              <td>Axelar GMP</td>
              <td>1st</td>
              <td>Lower cost, wider chain support</td>
            </tr>
            <tr>
              <td><strong>Fallback</strong></td>
              <td>Chainlink CCIP</td>
              <td>2nd</td>
              <td>Used automatically if Axelar call reverts</td>
            </tr>
          </tbody>
        </table>

        <div className="docs-callout warning">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </span>
          <div>
            If <em>both</em> GMP routes fail, a <code>CrossChainDispatchFailed</code> event is emitted from <code>AutopayModule</code>.
            The billing payment succeeds, but the mirror on the destination chain will not be updated until the next renewal.
          </div>
        </div>

        <h2 id="mirror-registry-api">MirrorRegistry API</h2>
        <CodeBlock lang="Solidity" code={`// Check if a subscriber has a valid mirrored subscription
function isValid(address subscriber) external view returns (bool);

// Get expiry timestamp for a subscriber
function expiresAt(address subscriber) external view returns (uint64);

// Get full mirrored subscription details
function getMirror(address subscriber) external view returns (MirroredSubscription memory);

// Get plan tier string for a subscriber
function getPlanTier(address subscriber) external view returns (string memory);

// MirroredSubscription struct
struct MirroredSubscription {
    address subscriber;
    uint256 planId;
    string  planTier;       // e.g. "pro", "enterprise"
    uint64  expiration;     // Unix timestamp
    uint256 sourceChainId;  // Chain ID where the original NFT lives
    uint256 sourceTokenId;  // ERC-721 token ID on source chain
    uint64  sourceUpdatedAt;
    uint64  lastUpdated;
}`} />

        <h2 id="gating-on-destination">Gating on a destination chain</h2>
        <CodeBlock lang="Solidity" code={`// contracts/MyDestinationContract.sol
pragma solidity ^0.8.24;

interface IMirrorRegistry {
    function isValid(address subscriber) external view returns (bool);
    function getPlanTier(address subscriber) external view returns (string memory);
}

contract MyDestinationContract {
    IMirrorRegistry public mirrorRegistry;

    constructor(address _mirrorRegistry) {
        mirrorRegistry = IMirrorRegistry(_mirrorRegistry);
    }

    modifier onlySubscriber() {
        require(
            mirrorRegistry.isValid(msg.sender),
            "ArcenPay: subscription required"
        );
        _;
    }

    function premiumAction() external onlySubscriber {
        // Only accessible to wallets with a valid mirrored subscription
    }
}`} />

        <h2 id="configuring-mirrors">Configuring MirrorRegistry</h2>
        <p>Deploy a <code>MirrorRegistry</code> on your destination chain and configure it as follows:</p>
        <CodeBlock lang="Solidity" code={`// 1. Authorize the Axelar GMP gateway on destination
MirrorRegistry.setAxelarGateway(axelarGatewayAddress);

// 2. Authorize CCIP router on destination
MirrorRegistry.setCCIPRouter(ccipRouterAddress);

// 3. Register the trusted source SubscriptionRegistry from source chain
// (sourceAddress = ABI-encoded registry address on source chain)
MirrorRegistry.setTrustedSource(
    sourceChainId,       // e.g. 11155111 for Sepolia
    abi.encodePacked(sourceRegistryAddress)
);

// 4. Authorize GMP bridge relayers
MirrorRegistry.authorizeBridge(axelarBridgeRelayer, sourceChainId);`} />

        <h2 id="cross-chain-events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>Contract</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>SubscriptionMirrored</code></td><td>MirrorRegistry</td><td><code>subscriber, sourceTokenId, sourceChainId, expiration</code></td></tr>
            <tr><td><code>CrossChainDispatchRequested</code></td><td>SubscriptionRegistry</td><td><code>tokenId, destinationChainId, route, messageId</code></td></tr>
            <tr><td><code>CrossChainFallbackTriggered</code></td><td>SubscriptionRegistry</td><td><code>tokenId, destinationChainId, errorData</code></td></tr>
            <tr><td><code>CrossChainDispatchFailed</code></td><td>AutopayModule</td><td><code>account, destinationChainId</code></td></tr>
            <tr><td><code>RoutedMessageProcessed</code></td><td>MirrorRegistry</td><td><code>messageId, route</code></td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#cross-chain">Cross-Chain</a></li>
          <li className="docs-toc-item"><a href="#how-it-works">How it works</a></li>
          <li className="docs-toc-item"><a href="#transport-routes">Transport routes</a></li>
          <li className="docs-toc-item"><a href="#mirror-registry-api">MirrorRegistry API</a></li>
          <li className="docs-toc-item"><a href="#gating-on-destination">Gating on destination</a></li>
          <li className="docs-toc-item"><a href="#configuring-mirrors">Configuring mirrors</a></li>
          <li className="docs-toc-item"><a href="#cross-chain-events">Events</a></li>
        </ul>
      </nav>
    </div>
  );
}
