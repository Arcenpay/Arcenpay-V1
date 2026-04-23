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

export default function ZKUsageVerifierPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Contracts</div>
        <div className="docs-page-title-row"><h1>ZKUsageVerifier</h1></div>

        <p className="docs-lead" id="zk-usage-verifier">
          <code>ZKUsageVerifier</code> verifies Groth16 zk-SNARK proofs generated off-chain and executes USDC settlement
          from the agent&apos;s <code>SessionVault</code>. Each proof can only be submitted once — a nullifier mapping prevents double-spend.
        </p>

        <h2 id="deployment">Deployment</h2>
        <table className="docs-table">
          <thead><tr><th>Network</th><th>Address</th><th>Chain ID</th></tr></thead>
          <tbody>
            <tr><td>Ethereum Sepolia</td><td><code>{getTestnetContractValue('zkUsageVerifier', 11155111)}</code></td><td>11155111</td></tr>
            <tr><td>Base Sepolia</td><td><code>{getTestnetContractValue('zkUsageVerifier', 84532)}</code></td><td>84532</td></tr>
          </tbody>
        </table>

        <h2 id="proof-types">Proof and input types</h2>
        <CodeBlock lang="Solidity" code={`struct Proof {
    uint256[2]    a;
    uint256[2][2] b;
    uint256[2]    c;
}

struct PublicInputs {
    bytes32 agentAddress;  // Agent wallet as bytes32
    bytes32 sessionId;     // SessionVault session
    uint256 callCount;     // Total API calls in the window
    uint64  windowStart;
    uint64  windowEnd;
    bytes32 merkleRoot;    // Merkle root of signed request logs
    bytes32 nullifier;     // Per-proof unique ID (prevents double-spend)
}`} />

        <h2 id="functions">Functions</h2>

        <h3>submitProof</h3>
        <CodeBlock lang="Solidity" code={`function submitProof(
    Proof calldata proof,
    PublicInputs calldata inputs
) external;
// 1. Check nullifier not used
// 2. Verify Groth16 proof on-chain
// 3. Mark nullifier as used
// 4. amount = callCount * ratePerCall
// 5. Settle from SessionVault after fee deduction`} />

        <h3>isNullifierUsed</h3>
        <CodeBlock lang="Solidity" code={`function isNullifierUsed(bytes32 nullifier) external view returns (bool);`} />

        <h3>getRateSchedule</h3>
        <CodeBlock lang="Solidity" code={`function getRateSchedule(uint256 planId) external view returns (uint256 ratePerCall);`} />

        <h3>Admin</h3>
        <CodeBlock lang="Solidity" code={`function setRateSchedule(uint256 planId, uint256 ratePerCall) external;
function setGroth16Verifier(address verifier) external;
function setSessionSettlementConfig(bytes32 sessionId, uint256 planId, address provider) external;`} />

        <h2 id="events">Events</h2>
        <table className="docs-table">
          <thead><tr><th>Event</th><th>Fields</th></tr></thead>
          <tbody>
            <tr><td><code>BillingSettled</code></td><td><code>sessionId, agentAddress, callCount, amount, windowStart, windowEnd</code></td></tr>
            <tr><td><code>Groth16VerifierSet</code></td><td><code>verifier</code></td></tr>
            <tr><td><code>SessionSettlementConfigured</code></td><td><code>sessionId, planId, provider</code></td></tr>
          </tbody>
        </table>

        <h2 id="errors">Revert reasons</h2>
        <table className="docs-table">
          <thead><tr><th>Reason</th><th>Cause</th></tr></thead>
          <tbody>
            <tr><td><code>ZKVerifier: nullifier already used</code></td><td>Double-spend attempt</td></tr>
            <tr><td><code>ZKVerifier: invalid proof</code></td><td>Groth16 verification failed</td></tr>
            <tr><td><code>ZKVerifier: no rate configured</code></td><td>No ratePerCall for planId</td></tr>
            <tr><td><code>ZKVerifier: future window</code></td><td>windowEnd is in the future</td></tr>
            <tr><td><code>ZKVerifier: zero calls</code></td><td>callCount == 0</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#zk-usage-verifier">ZKUsageVerifier</a></li>
          <li className="docs-toc-item"><a href="#deployment">Deployment</a></li>
          <li className="docs-toc-item"><a href="#proof-types">Proof types</a></li>
          <li className="docs-toc-item"><a href="#functions">Functions</a></li>
          <li className="docs-toc-item"><a href="#events">Events</a></li>
          <li className="docs-toc-item"><a href="#errors">Revert reasons</a></li>
        </ul>
      </nav>
    </div>
  );
}
