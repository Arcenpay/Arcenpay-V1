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

export default function AgentSDKPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Integrate</div>
        <div className="docs-page-title-row"><h1>Agent SDK</h1></div>

        <p className="docs-lead" id="agent-sdk">
          The <code>@arcenpay/agent</code> SDK enables autonomous AI agents to manage their own payment sessions and 
          participate in the 402-based metered billing ecosystem (ZKVUB).
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/agent`} />

        <h2 id="x402-client">x402 Client</h2>
        <p>This client automatically manages the HTTP 402 flow — attaching session IDs to headers and handling top-ups when a session is low.</p>
        <CodeBlock lang="typescript" code={`import { x402Client } from '@arcenpay/agent';

const agent = new x402Client({
  sessionId: '0x...', 
  privateKey: '0x...', // To sign request hashes
});

const response = await agent.fetch('https://api.provider.com/generate', {
  method: 'POST',
  body: JSON.stringify({ prompt: 'Hello' })
});`} />

        <h2 id="session-management">Session Management</h2>
        <p>Agents can monitor and fund their own sessions on-chain.</p>
        <CodeBlock lang="typescript" code={`import { SessionManager } from '@arcenpay/agent';

const manager = new SessionManager(rpcUrl);

// Fund a new session with 50 USDC
const sessionId = await manager.fund('50.0');

// Check remaining balance
const balance = await manager.getBalance(sessionId);
console.log(\`Remaining: \${balance} USDC\`);`} />

        <h2 id="zk-proofs">Proof Generation (Advanced)</h2>
        <p>If your agent is acting as a facilitator, use the SDK to generate Groth16 zk-SNARK proofs of usage.</p>
        <CodeBlock lang="typescript" code={`import { ZKProver } from '@arcenpay/agent';

const prover = new ZKProver();
const proof = await prover.generateUsageProof({
  requests: loggedRequests,
  merkleTree: tree
});

// Submit to ZKUsageVerifier contract
await manager.submitSettlementProof(proof);`} />

        <h2 id="features">Key Features</h2>
        <ul>
          <li><strong>Autonomous Top-up:</strong> Set a threshold (e.g., 5 USDC) and the agent will automatically call <code>SessionVault.topUp()</code> using its own wallet.</li>
          <li><strong>Signature Chaining:</strong> Requests are signed with a nonce to prevent replay attacks and ensure sequential billing.</li>
          <li><strong>Multi-Session:</strong> Manage multiple sessions across different providers from a single agent instance.</li>
        </ul>

        <div className="docs-callout info">
          <span className="docs-callout-icon">🤖</span>
          <div>
            The Agent SDK is compatible with Browser, Node.js, and Edge runtimes, making it ideal for LangChain or AutoGPT deployments.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#agent-sdk">Agent SDK</a></li>
          <li className="docs-toc-item"><a href="#installation">Installation</a></li>
          <li className="docs-toc-item"><a href="#x402-client">x402 Client</a></li>
          <li className="docs-toc-item"><a href="#session-management">Session Management</a></li>
          <li className="docs-toc-item"><a href="#features">Features</a></li>
        </ul>
      </nav>
    </div>
  );
}
