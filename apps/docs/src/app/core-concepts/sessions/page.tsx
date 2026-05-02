'use client';

import { useState } from 'react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button
          className="docs-codeblock-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
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
        <div className="docs-page-title-row"><h1>Sessions and Proofs</h1></div>

        <p className="docs-lead" id="sessions">
          Sessions are prefunded USDC balances used for metered x402-style
          billing. The facilitator records usage, proof jobs aggregate the usage
          window, and settlement writes are executed against the session vault.
        </p>

        <h2 id="flow">Current runtime flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Fund a session</div>
              <p className="docs-step-desc">
                The agent deposits USDC into <code>SessionVault</code> and
                receives a session identifier.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Make paid requests</div>
              <p className="docs-step-desc">
                The agent signs x402 requests while the facilitator tracks
                request usage and settlement windows.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Aggregate and prove</div>
              <p className="docs-step-desc">
                Usage is aggregated into proof-ready windows. Depending on your
                environment, the proving pipeline may still be partially wired,
                so operator visibility matters here.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Settle on-chain</div>
              <p className="docs-step-desc">
                The proof verifier and session vault settle the provider amount
                from the funded session balance.
              </p>
            </div>
          </div>
        </div>

        <h2 id="agent-example">Agent example</h2>
        <CodeBlock
          lang="ts"
          code={`import { x402Client } from '@arcenpay/agent';

const client = x402Client({
  sessionId,
  sessionVaultAddress: process.env.SESSION_VAULT_ADDRESS,
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

const response = await client.get('https://api.example.com/premium-data');`}
        />

        <h2 id="ops">Operator notes</h2>
        <ul>
          <li>Base Sepolia should be the aligned chain for dashboard and facilitator runtime.</li>
          <li>If the facilitator is on another chain, the dashboard should report degraded proof visibility rather than fake empty data.</li>
          <li>Proof aggregation durability still matters because memory-only paths can lose state after restart.</li>
        </ul>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sessions">Sessions and Proofs</a></li>
          <li className="docs-toc-item"><a href="#flow">Current runtime flow</a></li>
          <li className="docs-toc-item"><a href="#agent-example">Agent example</a></li>
          <li className="docs-toc-item"><a href="#ops">Operator notes</a></li>
        </ul>
      </nav>
    </div>
  );
}
