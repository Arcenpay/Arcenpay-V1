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

export default function FeatureGatingGuide() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Guides</div>
        <div className="docs-page-title-row"><h1>Feature Gating</h1></div>

        <p className="docs-lead" id="gating">
          Use dynamic feature flags stored on decentralized storage (Tableland) and encrypted 
          with Lit Protocol to enable/disable features for specific subscription tiers.
        </p>

        <h2 id="concept">Overview</h2>
        <p>
          Instead of hard-coding features to plan tiers, ArcenPay lets you define a JSON configuration 
          for each tier. When a user subscribes, they unlock the configuration for their specific plan.
        </p>

        <h2 id="configuring">Configuring Flags</h2>
        <p>In your provider settings, define your feature schema:</p>
        <CodeBlock lang="json" code={`{
  "pro": {
    "max_projects": 50,
    "beta_editor": true,
    "api_access": true
  },
  "standard": {
    "max_projects": 5,
    "beta_editor": false,
    "api_access": false
  }
}`} />

        <h2 id="sdk-usage">Using flags in React</h2>
        <p>The <code>useFeatureFlags</code> hook handles the decryption and fetching automatically.</p>
        <CodeBlock lang="tsx" code={`const { flags, loading } = useFeatureFlags();

if (loading) return <Spinner />;

return (
  <nav>
    <Link href="/dashboard">Dashboard</Link>
    {flags.api_access && <Link href="/dev">API Settings</Link>}
    <p>Limit: {flags.max_projects} projects</p>
  </nav>
);`} />

        <h2 id="server-usage">Using flags in Node.js</h2>
        <p>For sensitive operations, verify the flags server-side.</p>
        <CodeBlock lang="typescript" code={`const flags = await client.getFeatureFlags(userWallet);

if (!flags.beta_editor) {
  throw new Error("Access Denied");
}`} />

        <h2 id="updates">Dynamic Updates</h2>
        <p>
          When you update flags in the dashboard, the changes are written to the <code>FeatureFlagRegistry</code> 
          contract. All subscribers immediately receive the updated configuration without a code deploy.
        </p>

        <div className="docs-callout tip">
          <span className="docs-callout-icon">💡</span>
          <div>
            Combine feature flags with <code>useSubscription</code> status to provide a &quot;grace period&quot; 
            where features remain active for 24 hours after an NFT expires.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#gating">Feature Gating</a></li>
          <li className="docs-toc-item"><a href="#concept">Overview</a></li>
          <li className="docs-toc-item"><a href="#configuring">Configuring</a></li>
          <li className="docs-toc-item"><a href="#sdk-usage">React Usage</a></li>
          <li className="docs-toc-item"><a href="#server-usage">Node Usage</a></li>
          <li className="docs-toc-item"><a href="#updates">Updates</a></li>
        </ul>
      </nav>
    </div>
  );
}
