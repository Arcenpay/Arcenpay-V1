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

export default function ApiAuthPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Authentication</h1></div>

        <p className="docs-lead" id="auth">
          ArcenPay uses API keys to authenticate requests from your server to our REST API.
          Secure your keys — they allow access to your provider data and billing configuration.
        </p>

        <h2 id="api-keys">API Keys</h2>
        <p>There are two types of keys:</p>
        <table className="docs-table">
          <thead><tr><th>Key Type</th><th>Prefix</th><th>Scope</th></tr></thead>
          <tbody>
            <tr><td><strong>Publishable Key</strong></td><td><code>pk_test_</code></td><td>Client-side safe. Used for loading designs and plans.</td></tr>
            <tr><td><strong>Secret Key</strong></td><td><code>sk_test_</code></td><td>Server-side only. Used for creating checkouts and verifying state.</td></tr>
          </tbody>
        </table>

        <h2 id="header">Using the header</h2>
        <p>Pass your Secret Key in the <code>Authorization</code> header using the Bearer scheme.</p>
        <CodeBlock lang="bash" code={`curl https://api.arcenpay.com/v1/plans \\
  -H "Authorization: Bearer sk_test_51Mz...a9Z"`} />

        <h2 id="sandbox">Sandbox vs Production</h2>
        <p>Keys with the <code>_test_</code> suffix interact with our Sepolia sandbox. Production keys (coming soon) will use the <code>_live_</code> suffix and interact with Mainnet.</p>

        <h2 id="errors">Authentication errors</h2>
        <p>If authentication fails, the API returns a <code>401 Unauthorized</code> response.</p>
        <CodeBlock lang="json" code={`{
  "error": {
    "type": "invalid_request_error",
    "message": "Invalid API key provided",
    "code": "api_key_invalid"
  }
}`} />

        <h2 id="best-practices">Security Best Practices</h2>
        <ul>
          <li><strong>Environment Variables:</strong> Store secret keys in <code>.env</code> files, never hardcode them.</li>
          <li><strong>IP Whitelisting:</strong> Configure whitelisted IPs in the dashboard to restrict where secret keys can be used.</li>
          <li><strong>Key Rotation:</strong> Rotate your keys immediately if you suspect they have been compromised.</li>
        </ul>

        <div className="docs-callout warning">
          <span className="docs-callout-icon">🔒</span>
          <div>
            Never commit your secret keys to public version control systems like GitHub.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#auth">Authentication</a></li>
          <li className="docs-toc-item"><a href="#api-keys">Types of keys</a></li>
          <li className="docs-toc-item"><a href="#header">Authorization header</a></li>
          <li className="docs-toc-item"><a href="#sandbox">Sandbox/Live</a></li>
          <li className="docs-toc-item"><a href="#errors">Errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
