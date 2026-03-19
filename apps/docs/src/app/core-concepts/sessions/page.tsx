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

export default function SessionsPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row">
          <h1>Sessions & Gas</h1>
        </div>

        <p className="docs-lead" id="sessions">
          Sessions are pre-funded USDC vaults that power the <strong>ZKVUB</strong> (Zero-Knowledge Verifiable Usage Billing)
          system. An AI agent deposits stablecoins into a <code>SessionVault</code>, makes API calls off-chain,
          and a Groth16 zk-SNARK proof is later submitted on-chain to settle the exact amount consumed.
        </p>

        <h2 id="how-sessions-work">How sessions work</h2>

        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Fund a session</div>
              <p className="docs-step-desc">Agent calls <code>SessionVault.fundSession(amount, usdcAddress)</code>. USDC is transferred into the vault and a unique <code>sessionId</code> (bytes32) is returned.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Make API calls (off-chain)</div>
              <p className="docs-step-desc">The agent uses the <code>X-PAYMENT</code> header (x402 protocol) to authorize metered calls. Each call is logged off-chain by the Facilitator node and signed.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Generate a zk-SNARK proof</div>
              <p className="docs-step-desc">At settlement threshold, a Groth16 (Circom) circuit proves the total <code>callCount</code> without revealing individual request data. The proof is submitted to <code>ZKUsageVerifier</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">On-chain settlement</div>
              <p className="docs-step-desc"><code>ZKUsageVerifier.submitProof()</code> validates the proof, calculates <code>callCount × ratePerCall</code>, and calls <code>SessionVault.settle()</code> to transfer USDC to the provider. The nullifier prevents double-spend.</p>
            </div>
          </div>
        </div>

        <h2 id="session-vault-api">SessionVault API</h2>
        <CodeBlock lang="Solidity" code={`// Create a new funded session — returns sessionId (bytes32)
function fundSession(
    uint256 amount,
    address token           // USDC contract address
) external returns (bytes32 sessionId);

// Add more funds to an existing session
function topUp(bytes32 sessionId, uint256 amount) external;

// Withdraw unused balance and close session
function withdraw(bytes32 sessionId) external;

// Query remaining balance for a session
function getBalance(bytes32 sessionId) external view returns (uint256);

// Query total active balance across all sessions for an agent
function getAgentBalance(address agent) external view returns (uint256);`} />

        <h2 id="session-struct">Session struct</h2>
        <CodeBlock lang="Solidity" code={`struct Session {
    address agent;        // Session owner (agent wallet)
    address token;        // Stablecoin used (USDC)
    uint256 balance;      // Remaining balance
    uint256 totalFunded;  // Total amount ever deposited
    uint256 totalSettled; // Total amount settled to provider
    bool    active;       // Whether session is still open
    uint64  createdAt;    // Unix timestamp of creation
}`} />

        <h2 id="funding-in-code">Funding a session in code</h2>
        <CodeBlock lang="TypeScript" code={`import { useSessionVault } from '@meap/agent';
import { parseUnits } from 'viem';

const { fundSession, withdraw } = useSessionVault();

// Fund a session with $50 USDC
const sessionId = await fundSession({
  amount: parseUnits('50', 6),        // 50 USDC (6 decimals)
  token: '0xA0b86a33...usdcAddress',  // USDC on Sepolia
});

console.log('Session funded:', sessionId);

// Later: withdraw unused balance
await withdraw({ sessionId });`} />

        <h2 id="zk-proof-submission">ZK proof submission</h2>
        <CodeBlock lang="Solidity" code={`// Submit a Groth16 proof to settle a session
function submitProof(
    Proof calldata proof,
    PublicInputs calldata inputs
) external;

struct PublicInputs {
    bytes32 agentAddress;  // Agent wallet (as bytes32)
    bytes32 sessionId;     // Session being settled
    uint256 callCount;     // Number of API calls in window
    uint64  windowStart;   // Unix timestamp — start of billing window
    uint64  windowEnd;     // Unix timestamp — end of billing window
    bytes32 merkleRoot;    // Merkle root of signed request logs
    bytes32 nullifier;     // Unique per-proof to prevent double-spend
}

struct Proof {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}`} />

        <h2 id="gas-policies">Gas policies</h2>
        <p>ArcenPay supports two gas handling modes for recurring billing transactions:</p>
        <table className="docs-table">
          <thead><tr><th>Policy</th><th>Who pays gas</th><th>Use case</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Self-pay</strong></td>
              <td>Subscriber&apos;s smart account (ERC-7579)</td>
              <td>Default — subscriber controls all costs</td>
            </tr>
            <tr>
              <td><strong>Gas sponsorship</strong></td>
              <td>Provider via Paymaster</td>
              <td>Seamless UX — provider subsidizes transaction fees</td>
            </tr>
          </tbody>
        </table>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </span>
          <div>
            Gas sponsorship uses a ZeroDev Paymaster. A dedicated Paymaster policy can be configured per plan-tier in the ArcenPay dashboard under <strong>Settings → Gas Policy</strong>.
          </div>
        </div>

        <h2 id="autopay-module">AutopayModule (ERC-7579)</h2>
        <p>
          For recurring subscriptions, ArcenPay uses the <strong>ERC7579AutopayModule</strong> installed on the subscriber&apos;s 
          smart account. The module is granted constrained pull-payment authority — it can only pull up to <code>maxAmount</code> 
          USDC once every <code>interval</code> seconds.
        </p>
        <CodeBlock lang="Solidity" code={`struct AutopayConfig {
    address merchant;    // Provider wallet (authorized caller)
    uint256 planId;      // Plan being billed for
    uint256 maxAmount;   // Maximum USDC per pull (≤ plan price)
    address token;       // USDC token contract
    uint32  interval;    // Seconds between pulls (≥ 30 days)
    uint64  startTime;   // When billing may begin (Unix timestamp)
}`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>Contract</th><th>Key fields</th></tr></thead>
          <tbody>
            <tr><td><code>SessionFunded</code></td><td>SessionVault</td><td><code>agent, sessionId, amount, token</code></td></tr>
            <tr><td><code>SessionSettled</code></td><td>SessionVault</td><td><code>sessionId, amount, provider</code></td></tr>
            <tr><td><code>SessionWithdrawn</code></td><td>SessionVault</td><td><code>sessionId, amount, agent</code></td></tr>
            <tr><td><code>BillingSettled</code></td><td>ZKUsageVerifier</td><td><code>sessionId, agent, callCount, amount, windowStart, windowEnd</code></td></tr>
            <tr><td><code>PaymentExecuted</code></td><td>AutopayModule</td><td><code>account, merchant, amount, timestamp</code></td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sessions">Sessions & Gas</a></li>
          <li className="docs-toc-item"><a href="#how-sessions-work">How sessions work</a></li>
          <li className="docs-toc-item"><a href="#session-vault-api">SessionVault API</a></li>
          <li className="docs-toc-item"><a href="#session-struct">Session struct</a></li>
          <li className="docs-toc-item"><a href="#funding-in-code">Funding in code</a></li>
          <li className="docs-toc-item"><a href="#zk-proof-submission">ZK proof submission</a></li>
          <li className="docs-toc-item"><a href="#gas-policies">Gas policies</a></li>
          <li className="docs-toc-item"><a href="#autopay-module">AutopayModule</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
        </ul>
      </nav>
    </div>
  );
}
