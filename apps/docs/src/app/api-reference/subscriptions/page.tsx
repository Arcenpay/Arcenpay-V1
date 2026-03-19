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

export default function ApiSubscriptionsPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Subscriptions API</h1></div>

        <p className="docs-lead" id="subscriptions">
          Query and manage subscriber state. Use this to sync on-chain NFT data with your internal databases.
        </p>

        <h2 id="list">List subscriptions</h2>
        <div className="api-endpoint badge-get">GET /v1/subscriptions</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/subscriptions?customer=0x... \\
  -H "Authorization: Bearer sk_test_..."`} />
        
        <h2 id="retrieve">Retrieve a subscription</h2>
        <div className="api-endpoint badge-get">GET /v1/subscriptions/:id</div>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/subscriptions/sub_123 \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h2 id="verify">Verify a wallet</h2>
        <div className="api-endpoint badge-get">GET /v1/verify/:wallet</div>
        <p>Fast helper endpoint to check if a wallet has any active subscription for your provider account.</p>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/verify/0x40d5... \\
  -H "Authorization: Bearer sk_test_..."`} />
        
        <h3 style={{ marginTop: 24 }}>Response</h3>
        <CodeBlock lang="json" code={`{
  "valid": true,
  "subscription": {
    "id": "sub_123",
    "planId": 1,
    "tier": "pro",
    "expiresAt": 1713442021
  }
}`} />

        <h2 id="cancel">Cancel a subscription</h2>
        <div className="api-endpoint badge-post">POST /v1/subscriptions/:id/cancel</div>
        <p>Triggers an on-chain cancellation transaction. Access will be revoked immediately.</p>
        <CodeBlock lang="bash" code={`curl -X POST https://api.arcenpay.com/v1/subscriptions/sub_123/cancel \\
  -H "Authorization: Bearer sk_test_..."`} />

        <h2 id="object">The Subscription Object</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>string</td><td>Internal identifier.</td></tr>
            <tr><td><code>customer</code></td><td>string</td><td>Wallet address of the subscriber.</td></tr>
            <tr><td><code>plan</code></td><td>object</td><td>Nested plan details.</td></tr>
            <tr><td><code>status</code></td><td>string</td><td>One of <code>active</code>, <code>expired</code>, or <code>cancelled</code>.</td></tr>
            <tr><td><code>expiresAt</code></td><td>integer</td><td>Unix timestamp of expiration.</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#subscriptions">Subscriptions API</a></li>
          <li className="docs-toc-item"><a href="#list">List subscriptions</a></li>
          <li className="docs-toc-item"><a href="#verify">Verify wallet</a></li>
          <li className="docs-toc-item"><a href="#cancel">Cancel</a></li>
          <li className="docs-toc-item"><a href="#object">Resource</a></li>
        </ul>
      </nav>
    </div>
  );
}
