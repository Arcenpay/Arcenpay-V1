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

export default function SubscriptionRegistryPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>SubscriptionRegistry</h1></div>

        <p className="docs-lead" id="subscription-registry">
          <code>SubscriptionRegistry</code> is an <strong>ERC-721 + ERC-5643</strong> smart contract. It mints one subscription NFT per wallet
          per registry, tracks expiry timestamps, and enables cross-chain state dispatch. Only <em>authorized billers</em>
          (AutopayModule or a custom integration) can mint or renew tokens.
        </p>

        <h2 id="deployment">Deployment</h2>
        <table className="docs-table">
          <thead><tr><th>Network</th><th>Address</th><th>Chain ID</th></tr></thead>
          <tbody>
            <tr><td>Ethereum Sepolia</td><td><code>{getTestnetContractValue('subscriptionRegistry', 11155111)}</code></td><td>11155111</td></tr>
            <tr><td>Base Sepolia</td><td><code>{getTestnetContractValue('subscriptionRegistry', 84532)}</code></td><td>84532</td></tr>
          </tbody>
        </table>

        <h2 id="functions">Functions</h2>

        <h3>mint (biller only)</h3>
        <p>Creates a new subscription NFT. If the wallet already has an NFT for the same plan, it renews instead of minting a new one.</p>
        <CodeBlock lang="Solidity" code={`function mint(
    address to,       // Subscriber wallet
    uint256 planId,   // Plan to subscribe to
    uint64 duration   // Subscription duration in seconds
) external returns (uint256 tokenId);`} />

        <h3>renew (biller only)</h3>
        <CodeBlock lang="Solidity" code={`// Extends an existing subscription.
// If currently active: adds extension to current expiry.
// If expired: restarts from now.
function renew(uint256 tokenId, uint64 extension) external;`} />

        <h3>cancel</h3>
        <CodeBlock lang="Solidity" code={`// Sets expiry to now (revokes access immediately).
// Can be called by the subscriber or any authorized biller.
function cancel(uint256 tokenId) external;`} />

        <h3>isValid</h3>
        <CodeBlock lang="Solidity" code={`// Returns true if the token exists and has not expired.
function isValid(uint256 tokenId) external view returns (bool);`} />

        <h3>hasActiveSubscription</h3>
        <CodeBlock lang="Solidity" code={`// Returns true if the wallet has a valid subscription right now.
// Preferred for access control — no need to know the token ID.
function hasActiveSubscription(address wallet) external view returns (bool);`} />

        <h3>getWalletSubscription</h3>
        <CodeBlock lang="Solidity" code={`// Returns the active token ID for a wallet (0 if none).
function getWalletSubscription(address wallet) external view returns (uint256);`} />

        <h3>expiresAt (ERC-5643)</h3>
        <CodeBlock lang="Solidity" code={`// Returns Unix expiration timestamp for a token.
function expiresAt(uint256 tokenId) external view returns (uint64);`} />

        <h3>getPlanFeatures</h3>
        <CodeBlock lang="Solidity" code={`// Returns planId and planTier bound to a token.
function getPlanFeatures(uint256 tokenId) external view returns (
    uint256 planId,
    string memory planTier
);`} />

        <h3>dispatchCrossChainUpdate (biller only)</h3>
        <CodeBlock lang="Solidity" code={`// Dispatches a GMP payload to MirrorRegistry on destination chain.
// Tries Axelar first, falls back to CCIP.
function dispatchCrossChainUpdate(
    uint256 tokenId,
    uint256 destinationChainId,
    address refundAddress
) external payable returns (bytes32 messageId, uint8 routeUsed);`} />

        <h3>Admin functions (owner only)</h3>
        <CodeBlock lang="Solidity" code={`function authorizeBiller(address biller) external;
function revokeBiller(address biller) external;
function authorizeBridge(address bridge) external;
function revokeBridge(address bridge) external;
function setCrossChainTransports(address axelarTransport, address ccipTransport) external;`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>Emitted when</th><th>Key fields</th></tr></thead>
          <tbody>
            <tr><td><code>SubscriptionMinted</code></td><td>New NFT minted</td><td><code>to, tokenId, planId, expiration</code></td></tr>
            <tr><td><code>SubscriptionUpdate</code></td><td>Any state change (ERC-5643)</td><td><code>tokenId, newExpiration</code></td></tr>
            <tr><td><code>SubscriptionRenewed</code></td><td>Renewal success</td><td><code>tokenId, newExpiration, amount</code></td></tr>
            <tr><td><code>SubscriptionCancelled</code></td><td>cancel() called</td><td><code>tokenId</code></td></tr>
            <tr><td><code>CrossChainDispatchRequested</code></td><td>GMP payload dispatched</td><td><code>tokenId, destinationChainId, route, messageId</code></td></tr>
            <tr><td><code>CrossChainFallbackTriggered</code></td><td>Primary route failed, using fallback</td><td><code>tokenId, destinationChainId, errorData</code></td></tr>
          </tbody>
        </table>

        <h2 id="errors">Revert reasons</h2>
        <table className="docs-table">
          <thead><tr><th>Reason</th><th>Cause</th></tr></thead>
          <tbody>
            <tr><td><code>SubscriptionRegistry: unauthorized biller</code></td><td>Caller not in authorizedBillers</td></tr>
            <tr><td><code>SubscriptionRegistry: plan inactive</code></td><td>planId.active is false</td></tr>
            <tr><td><code>SubscriptionRegistry: nonexistent token</code></td><td>tokenId has no owner</td></tr>
            <tr><td><code>SubscriptionRegistry: zero duration</code></td><td>duration == 0</td></tr>
            <tr><td><code>SubscriptionRegistry: no fallback transport</code></td><td>Both Axelar and CCIP unconfigured</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#subscription-registry">SubscriptionRegistry</a></li>
          <li className="docs-toc-item"><a href="#deployment">Deployment</a></li>
          <li className="docs-toc-item"><a href="#functions">Functions</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
          <li className="docs-toc-item"><a href="#errors">Revert reasons</a></li>
        </ul>
      </nav>
    </div>
  );
}
