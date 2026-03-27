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

export default function AutopayModulePage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>ERC7579AutopayModule</h1></div>

        <p className="docs-lead" id="autopay-module">
          <code>ERC7579AutopayModule</code> is an <strong>ERC-7579 Executor module</strong> (typeId = 2) that is installed on a
          subscriber&apos;s smart account. It grants the provider constrained pull-payment authority — the provider can pull USDC at most
          once per billing interval, capped at <code>maxAmount</code>.
        </p>

        <h2 id="autopay-config">AutopayConfig struct</h2>
        <CodeBlock lang="Solidity" code={`struct AutopayConfig {
    address merchant;    // Provider wallet — only authorized caller for execute()
    uint256 planId;      // Plan being billed for
    uint256 maxAmount;   // Max USDC per pull (must be <= plan.price)
    address token;       // USDC token contract address
    uint32  interval;    // Seconds between pulls (minimum 2,592,000 = 30 days)
    uint64  startTime;   // Unix timestamp — billing cannot start before this
}`} />

        <h2 id="erc7579-interface">ERC-7579 module interface</h2>

        <h3>onInstall</h3>
        <p>Called by the subscriber&apos;s smart account when the module is installed. Accepts ABI-encoded <code>AutopayConfig</code>.</p>
        <CodeBlock lang="Solidity" code={`function onInstall(bytes calldata data) external;

// Encode the config before installing:
bytes memory initData = abi.encode(AutopayConfig({
    merchant: providerAddress,
    planId: 2,
    maxAmount: 10_000_000, // $10 USDC
    token: usdcAddress,
    interval: 2_592_000,   // 30 days
    startTime: uint64(block.timestamp)
}));
// Then install via ERC-7579 account.installModule(MODULE_TYPE_EXECUTOR, moduleAddress, initData)`} />

        <h3>onUninstall</h3>
        <p>Removes the module from the smart account. After calling this, the provider cannot pull USDC. Equivalent to subscription cancellation.</p>
        <CodeBlock lang="Solidity" code={`function onUninstall(bytes calldata) external;`} />

        <h3>execute (merchant only)</h3>
        <p>The core billing function — only callable by the <code>merchant</code> address defined in the config.</p>
        <CodeBlock lang="Solidity" code={`function execute(address account, uint256 amount) external;
// Verifications performed:
// 1. Module is initialized for account
// 2. Caller is config.merchant
// 3. amount > 0 && amount <= config.maxAmount
// 4. block.timestamp >= lastPullTime + config.interval (velocity check)
// 5. block.timestamp >= config.startTime (first pull only)`} />

        <h3>canExecute</h3>
        <CodeBlock lang="Solidity" code={`// Returns true if execute() would succeed right now.
// Use to check before submitting a billing transaction.
function canExecute(address account) external view returns (bool);`} />

        <h3>getConfig</h3>
        <CodeBlock lang="Solidity" code={`function getConfig(address account) external view returns (AutopayConfig memory config);`} />

        <h3>lastPullTime</h3>
        <CodeBlock lang="Solidity" code={`function lastPullTime(address account) external view returns (uint64);`} />

        <h3>isInitialized</h3>
        <CodeBlock lang="Solidity" code={`function isInitialized(address smartAccount) external view returns (bool);`} />

        <h2 id="billing-flow">Billing flow inside execute()</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Verify caller &amp; limits</div>
              <p className="docs-step-desc">Checks merchant identity, amount bounds, and interval elapsed since last pull.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Update last pull time (CEI pattern)</div>
              <p className="docs-step-desc">Writes <code>_lastPullTimes[account] = now</code> before any external calls to prevent reentrancy.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Calculate &amp; transfer fees</div>
              <p className="docs-step-desc">Calls <code>FeeCollector.collectSubscriptionFeeFor(amount, merchant)</code>. Transfers <code>merchantAmount</code> to provider and <code>feeAmount</code> to FeeCollector.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Mint or renew subscription NFT</div>
              <p className="docs-step-desc">If no existing token for this plan: calls <code>SubscriptionRegistry.mint()</code>. If token exists: calls <code>renew(tokenId, interval)</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">5</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Optional cross-chain dispatch</div>
              <p className="docs-step-desc">If <code>mirrorDestinationChainId != 0</code>, attempts GMP update to MirrorRegistry. Failure is non-reverting.</p>
            </div>
          </div>
        </div>

        <h2 id="constants">Constants</h2>
        <CodeBlock lang="Solidity" code={`uint256 public constant MODULE_TYPE_EXECUTOR = 2;   // ERC-7579 module type
uint32  public constant MIN_INTERVAL = 2_592_000;   // 30 days minimum`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>When</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>AutopayConfigured</code></td><td>onInstall succeeds</td><td><code>account, merchant, maxAmount, token, interval</code></td></tr>
            <tr><td><code>AutopayRevoked</code></td><td>onUninstall succeeds</td><td><code>account</code></td></tr>
            <tr><td><code>PaymentExecuted</code></td><td>execute() succeeds</td><td><code>account, merchant, amount, timestamp</code></td></tr>
            <tr><td><code>CrossChainDispatchFailed</code></td><td>GMP dispatch failed (non-reverting)</td><td><code>account, destinationChainId</code></td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#autopay-module">AutopayModule</a></li>
          <li className="docs-toc-item"><a href="#autopay-config">AutopayConfig struct</a></li>
          <li className="docs-toc-item"><a href="#erc7579-interface">ERC-7579 interface</a></li>
          <li className="docs-toc-item"><a href="#billing-flow">Billing flow</a></li>
          <li className="docs-toc-item"><a href="#constants">Constants</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
        </ul>
      </nav>
    </div>
  );
}
