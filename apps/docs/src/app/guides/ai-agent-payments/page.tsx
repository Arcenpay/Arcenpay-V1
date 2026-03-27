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

export default function AIAgentPaymentsGuide() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Guides</div>
        <div className="docs-page-title-row"><h1>AI Agent Micropayments</h1></div>

        <p className="docs-lead" id="ai-agents">
          Implement metered, pay-as-you-go billing for AI agents using ArcenPay&apos;s ZKVUB (Zero-Knowledge Verified Usage Billing).
        </p>

        <h2 id="why-zkvub">Why ZKVUB?</h2>
        <p>
          Traditional subscriptions are often inefficient for high-frequency AI agents. ZKVUB allows agents 
          to pay exactly for the tokens or compute they consume, settled every few hours via a ZK-proof 
          of usage to minimize gas costs.
        </p>

        <h2 id="step-1">1. Deposit to SessionVault</h2>
        <p>The agent (or its owner) must fund a session with USDC.</p>
        <CodeBlock lang="typescript" code={`import { SessionManager } from '@arcenpay/agent';

const manager = new SessionManager(RPC_URL);
const sessionId = await manager.fundSession("10.0"); // 10 USDC`} />

        <h2 id="step-2">2. Authenticate with HTTP 402</h2>
        <p>The agent includes its session ID in all API requests. The provider responds with 402 if billing fails.</p>
        <CodeBlock lang="bash" code={`curl https://api.llm-provider.com/v1/chat \\
  -H "X-ArcenPay-Session: 0xa1b2..." \\
  -d '{"prompt": "Generate code"}'`} />

        <h2 id="step-3">3. Tracking Usage</h2>
        <p>The provider logs every request. Each log entry is hashed into a Merkle Tree.</p>
        <CodeBlock lang="typescript" code={`provider.logRequest({
  sessionId: "0xa1b2...",
  cost: "0.005",
  nonce: 42
});`} />

        <h2 id="step-4">4. ZK-Settlement</h2>
        <p>
          Once usage reaches a threshold (e.g. $1.00), the provider generates a ZK-SNARK proof that the 
          hashes in its tree represent valid usage of the agent&apos;s session.
        </p>
        <CodeBlock lang="typescript" code={`const proof = await prover.generateProof(logs);
await verifierContract.submitSettlement(sessionId, proof);`} />

        <h2 id="architecture">Flow Diagram</h2>
        <div style={{ padding: '24px', backgroundColor: '#f9fafb', borderRadius: '12px', textAlign: 'center', margin: '24px 0', border: '1px solid #e5e7eb' }}>
          <code style={{ fontSize: '13px' }}>Agent --[Request + SessionID]--&gt; Provider --[Response]--&gt; Agent</code><br/>
          <code style={{ fontSize: '13px', color: '#6b7280' }}>Provider --[ZK Proof]--&gt; Smart Contract --[USDC]--&gt; Provider</code>
        </div>

        <div className="docs-callout warning">
          <span className="docs-callout-icon">🤖</span>
          <div>
            The <code>@arcenpay/agent</code> SDK handles top-ups automatically. If the session balance
            drops below $1.00, it will trigger a re-funding transaction using the agent&apos;s wallet.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#ai-agents">AI Payments</a></li>
          <li className="docs-toc-item"><a href="#why-zkvub">Why ZKVUB?</a></li>
          <li className="docs-toc-item"><a href="#step-1">1. Deposit</a></li>
          <li className="docs-toc-item"><a href="#step-2">2. 402 Flow</a></li>
          <li className="docs-toc-item"><a href="#step-3">3. Tracking</a></li>
          <li className="docs-toc-item"><a href="#step-4">4. Settlement</a></li>
        </ul>
      </nav>
    </div>
  );
}
