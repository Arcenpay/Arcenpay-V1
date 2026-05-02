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

export default function FeatureGatingGuide() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Guides</div>
        <div className="docs-page-title-row"><h1>Feature Gating</h1></div>

        <p className="docs-lead" id="gating">
          Feature gating in the current product is driven by dashboard-managed
          rules, company overrides, active subscriptions, and add-on grants.
          Optional Lit or zkTLS integrations can enrich the model, but they are
          not the primary source of truth for launch-time entitlements.
        </p>

        <h2 id="model">How the live model works</h2>
        <ol>
          <li>Resolve the company and its active plan or subscription state.</li>
          <li>Resolve active add-on grants for standalone purchases or upsells.</li>
          <li>Apply company overrides.</li>
          <li>Evaluate prioritized rules for traits, usage thresholds, or zkTLS claims.</li>
        </ol>

        <h2 id="api">Server-side gating</h2>
        <CodeBlock
          lang="ts"
          code={`const response = await fetch('/api/v1/check', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    companyId: 'company_123',
    featureKey: 'priority_support',
  }),
});

const result = await response.json();
if (!result.enabled) throw new Error('Upgrade required');`}
        />

        <h2 id="react">Client-side checks</h2>
        <CodeBlock
          lang="tsx"
          code={`import { useEntitlementCheck } from '@arcenpay/react';

function ExportButton() {
  const { result, loading } = useEntitlementCheck('analytics_export');

  if (loading) return null;
  if (!result?.enabled) return <UpgradePrompt />;

  return <button>Export CSV</button>;
}`}
        />

        <h2 id="operational-notes">Operational notes</h2>
        <ul>
          <li>Use add-on grants for one-time or upsell unlocks instead of custom JSON-only access hacks.</li>
          <li>Keep sensitive access checks on the server even if the React UI hides locked controls.</li>
          <li>Only document Lit-encrypted content if your project has implemented the encryption write path too.</li>
        </ul>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#gating">Feature Gating</a></li>
          <li className="docs-toc-item"><a href="#model">Model</a></li>
          <li className="docs-toc-item"><a href="#api">Server-side gating</a></li>
          <li className="docs-toc-item"><a href="#react">Client-side checks</a></li>
          <li className="docs-toc-item"><a href="#operational-notes">Operational notes</a></li>
        </ul>
      </nav>
    </div>
  );
}
