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

export default function SessionVaultPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>SessionVault</h1></div>

        <p className="docs-lead" id="session-vault">
          <code>SessionVault</code> holds pre-funded USDC balances for the ZKVUB subsystem. AI agents deposit stablecoins before
          starting a metered billing session. The <code>ZKUsageVerifier</code> (an authorized settler) deducts the exact settlement
          amount after verifying a zk-SNARK proof.
        </p>

        <h2 id="deployment">Deployment</h2>
        <table className="docs-table">
          <thead><tr><th>Network</th><th>Address</th><th>Chain ID</th></tr></thead>
          <tbody>
            <tr><td>Sepolia ETH</td><td><code>0xdAC17F958D2ee523a2206206994597C13D831ec7</code></td><td>11155111</td></tr>
          </tbody>
        </table>

        <h2 id="session-struct">Session struct</h2>
        <CodeBlock lang="Solidity" code={`struct Session {
    address agent;        // Session owner (agent wallet)
    address token;        // Stablecoin (USDC)
    uint256 balance;      // Current remaining balance
    uint256 totalFunded;  // Total ever deposited into this session
    uint256 totalSettled; // Total already settled to providers
    bool    active;       // false after withdraw()
    uint64  createdAt;    // Creation timestamp (Unix)
}`} />

        <h2 id="functions">Functions</h2>

        <h3>fundSession</h3>
        <p>Creates a new session. Transfers USDC from the agent to the vault. Returns a unique <code>sessionId</code> (bytes32).</p>
        <CodeBlock lang="Solidity" code={`function fundSession(
    uint256 amount,      // USDC amount (6 decimals)
    address token        // USDC contract address
) external returns (bytes32 sessionId);

// sessionId = keccak256(abi.encodePacked(
//     msg.sender, token, amount, block.timestamp, nonce++
// ))`} />

        <h3>topUp</h3>
        <p>Adds more USDC to an existing active session.</p>
        <CodeBlock lang="Solidity" code={`function topUp(bytes32 sessionId, uint256 amount) external;
// Requires: session.active == true && session.agent == msg.sender`} />

        <h3>settle (settler only)</h3>
        <p>Deducts from session balance and transfers to provider. Only callable by <code>ZKUsageVerifier</code> (an authorized settler).</p>
        <CodeBlock lang="Solidity" code={`function settle(
    bytes32 sessionId,
    uint256 amount,       // Amount to deduct from session
    address provider      // Transfer recipient
) external;
// Requires: session.balance >= amount`} />

        <h3>withdraw</h3>
        <p>Refunds remaining balance to the agent and closes the session.</p>
        <CodeBlock lang="Solidity" code={`function withdraw(bytes32 sessionId) external;
// Requires: session.agent == msg.sender && session.active
// Effect: session.active = false, transfers remaining balance`} />

        <h3>getBalance</h3>
        <CodeBlock lang="Solidity" code={`function getBalance(bytes32 sessionId) external view returns (uint256);`} />

        <h3>getAgentBalance</h3>
        <CodeBlock lang="Solidity" code={`// Returns total balance across ALL active sessions for an agent
function getAgentBalance(address agent) external view returns (uint256);`} />

        <h3>getSession</h3>
        <CodeBlock lang="Solidity" code={`function getSession(bytes32 sessionId) external view returns (Session memory);`} />

        <h3>getAgentSessions</h3>
        <CodeBlock lang="Solidity" code={`// Returns all session IDs ever created by an agent (including closed)
function getAgentSessions(address agent) external view returns (bytes32[] memory);`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>When</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>SessionFunded</code></td><td>fundSession or topUp</td><td><code>agent, sessionId, amount, token</code></td></tr>
            <tr><td><code>SessionSettled</code></td><td>settle() succeeds</td><td><code>sessionId, amount, provider</code></td></tr>
            <tr><td><code>SessionWithdrawn</code></td><td>withdraw() succeeds</td><td><code>sessionId, amount, agent</code></td></tr>
          </tbody>
        </table>

        <h2 id="errors">Revert reasons</h2>
        <table className="docs-table">
          <thead><tr><th>Reason</th><th>Cause</th></tr></thead>
          <tbody>
            <tr><td><code>SessionVault: unauthorized settler</code></td><td>Caller not in authorizedSettlers</td></tr>
            <tr><td><code>SessionVault: session not active</code></td><td>Session was already withdrawn</td></tr>
            <tr><td><code>SessionVault: insufficient balance</code></td><td>settlement amount &gt; session balance</td></tr>
            <tr><td><code>SessionVault: not session owner</code></td><td>Only agent can topUp or withdraw</td></tr>
            <tr><td><code>SessionVault: zero amount</code></td><td>Funding or settlement with 0</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#session-vault">SessionVault</a></li>
          <li className="docs-toc-item"><a href="#deployment">Deployment</a></li>
          <li className="docs-toc-item"><a href="#session-struct">Session struct</a></li>
          <li className="docs-toc-item"><a href="#functions">Functions</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
          <li className="docs-toc-item"><a href="#errors">Revert reasons</a></li>
        </ul>
      </nav>
    </div>
  );
}
