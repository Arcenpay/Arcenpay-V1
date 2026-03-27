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

export default function ApiSessionsPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Sessions API (ZKVUB)</h1></div>

        <p className="docs-lead" id="sessions">
          Manage ZKVUB payment sessions for AI agents. This API interacts with the <code>SessionVault</code> contract.
        </p>

        <h2 id="list">List agent sessions</h2>
        <div className="api-endpoint badge-get">GET /v1/sessions?agent=0x...</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/sessions?agent=0x... \\
  -H "Authorization: Bearer sk_test_..."`} />
        
        <h2 id="retrieve">Retrieve a session</h2>
        <div className="api-endpoint badge-get">GET /v1/sessions/:id</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/sessions/0xa1b2... \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h2 id="usage">Fetch usage logs</h2>
        <div className="api-endpoint badge-get">GET /v1/sessions/:id/usage</div>
        <p>Returns the detailed logs of API calls made using this session, which form the basis of the next ZK proof.</p>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/sessions/0xa1b2/usage \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h3 style={{ marginTop: 24 }}>Response</h3>
        <CodeBlock lang="json" code={`{
  "sessionId": "0xa1b2...",
  "currentCallCount": 142,
  "lastSettledAt": 1710850021,
  "logs": [
    { "id": "req_1", "timestamp": 1710850500, "cost": "0.01" },
    { "id": "req_2", "timestamp": 1710850600, "cost": "0.01" }
  ]
}`} />

        <h2 id="settle">Trigger settlement</h2>
        <div className="api-endpoint badge-post">POST /v1/sessions/:id/settle</div>
        <p>Signals our ZK-Prover service to generate a settlement proof and submit it to the chain.</p>
        <CodeBlock lang="bash" code={`curl -X POST https://api.arcenpay.com/v1/sessions/0xa1b2/settle \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h2 id="object">The Session Resource</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>string</td><td>The <code>bytes32</code> session ID on-chain.</td></tr>
            <tr><td><code>agent</code></td><td>string</td><td>Wallet address of the AI agent.</td></tr>
            <tr><td><code>balance</code></td><td>string</td><td>Remaining USDC balance (base units).</td></tr>
            <tr><td><code>totalSettled</code></td><td>string</td><td>Total USDC already paid to the provider.</td></tr>
            <tr><td><code>status</code></td><td>string</td><td><code>active</code> or <code>exhausted</code>.</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#sessions">Sessions API</a></li>
          <li className="docs-toc-item"><a href="#list">List sessions</a></li>
          <li className="docs-toc-item"><a href="#retrieve">Retrieve</a></li>
          <li className="docs-toc-item"><a href="#usage">Usage logs</a></li>
          <li className="docs-toc-item"><a href="#settle">Settle</a></li>
          <li className="docs-toc-item"><a href="#object">Resource</a></li>
        </ul>
      </nav>
    </div>
  );
}
