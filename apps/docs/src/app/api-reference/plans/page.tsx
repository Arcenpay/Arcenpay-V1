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

export default function ApiPlansPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Plans API</h1></div>

        <p className="docs-lead" id="plans">
          Manage your subscription plans via the REST API. While most plans are created via the Dashboard GUI, 
          the API allows for programmatic plan management.
        </p>

        <h2 id="list">List all plans</h2>
        <p>Returns a paginated list of plans registered to your provider account.</p>
        <div className="api-endpoint badge-get">GET /v1/plans</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/plans \\
  -H "Authorization: Bearer sk_test_..."`} />
        
        <h3 style={{ marginTop: 24 }}>Response</h3>
        <CodeBlock lang="json" code={`{
  "object": "list",
  "data": [
    {
      "id": "plan_123",
      "onChainId": 1,
      "name": "Standard Monthly",
      "tier": "standard",
      "price": 10000000,
      "currency": "usdc",
      "interval": 2592000,
      "active": true
    }
  ],
  "has_more": false
}`} />

        <h2 id="retrieve">Retrieve a plan</h2>
        <div className="api-endpoint badge-get">GET /v1/plans/:id</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/plans/plan_123 \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h2 id="create">Create a plan</h2>
        <div className="api-endpoint badge-post">POST /v1/plans</div>
        <p>This triggers an on-chain registration. Your wallet must have a linked signing key.</p>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/plans \\
  -H "Authorization: Bearer sk_test_..." \\
  -d name="Pro Annual" \\
  -d tier="pro" \\
  -d price=99000000 \\
  -d currency="usdc" \\
  -d interval=31536000`} />

        <h2 id="update">Update a plan</h2>
        <div className="api-endpoint badge-post">POST /v1/plans/:id</div>
        <p>Currently, only <code>metadata</code> and <code>status</code> (deactivate) can be updated.</p>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/plans/plan_123 \\
  -H "Authorization: Bearer sk_test_..." \\
  -d active=false`} />

        <h2 id="objects">The Plan Object</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>string</td><td>Internal API identifier.</td></tr>
            <tr><td><code>onChainId</code></td><td>integer</td><td>The <code>planId</code> in the <code>PlanFactory</code> contract.</td></tr>
            <tr><td><code>price</code></td><td>integer</td><td>Price in base units (e.g. 10000000 for $10 USDC).</td></tr>
            <tr><td><code>interval</code></td><td>integer</td><td>Billing interval in seconds.</td></tr>
            <tr><td><code>active</code></td><td>boolean</td><td>Whether new subscriptions can be created.</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#plans">Plans API</a></li>
          <li className="docs-toc-item"><a href="#list">List plans</a></li>
          <li className="docs-toc-item"><a href="#retrieve">Retrieve</a></li>
          <li className="docs-toc-item"><a href="#create">Create</a></li>
          <li className="docs-toc-item"><a href="#update">Update</a></li>
          <li className="docs-toc-item"><a href="#objects">Plan Object</a></li>
        </ul>
      </nav>
    </div>
  );
}
