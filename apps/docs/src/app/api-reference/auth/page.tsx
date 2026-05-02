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

export default function ApiAuthPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Authentication</h1></div>

        <p className="docs-lead" id="auth">
          External provider APIs are authenticated with ArcenPay API keys. The
          current implementation accepts keys that begin with
          <code>api_</code>, stores only the SHA-256 hash, and resolves them to
          a team at request time.
        </p>

        <h2 id="key-format">Key format</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Behavior</th></tr></thead>
          <tbody>
            <tr><td>Prefix</td><td><code>api_</code></td></tr>
            <tr><td>Storage</td><td>Hashed before persistence</td></tr>
            <tr><td>Presentation</td><td>Shown in full only at creation time</td></tr>
            <tr><td>Lookup</td><td>Resolved from <code>Authorization</code> or <code>x-api-key</code></td></tr>
          </tbody>
        </table>

        <h2 id="header">Using the header</h2>
        <CodeBlock
          lang="bash"
          code={`curl https://your-dashboard.example.com/api/v1/check \\
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"companyId":"company_123","featureKey":"priority_support"}'`}
        />

        <h2 id="behavior">Current runtime behavior</h2>
        <ul>
          <li>The server also accepts the raw key in <code>x-api-key</code>.</li>
          <li>Malformed keys are rejected before DB lookup.</li>
          <li>Per-key rate limiting is applied after the key resolves.</li>
        </ul>

        <h2 id="errors">Authentication errors</h2>
        <CodeBlock
          lang="json"
          code={`{
  "error": "Invalid or revoked API key"
}`}
        />
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#auth">Authentication</a></li>
          <li className="docs-toc-item"><a href="#key-format">Key format</a></li>
          <li className="docs-toc-item"><a href="#header">Authorization header</a></li>
          <li className="docs-toc-item"><a href="#behavior">Runtime behavior</a></li>
          <li className="docs-toc-item"><a href="#errors">Errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
