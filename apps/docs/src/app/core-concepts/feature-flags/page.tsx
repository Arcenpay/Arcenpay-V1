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

export default function FeatureFlagsPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row">
          <h1>Feature Flags</h1>
        </div>

        <p className="docs-lead" id="feature-flags">
          Feature flags let you gate individual product capabilities based on a subscriber&apos;s active plan tier.
          Flags are stored in <strong>Tableland</strong> (a decentralized SQL database) and evaluated on-chain via
          <strong> Lit Protocol Access Control Conditions (ACCs)</strong>. Off-chain checks use the <code>@meap/react</code> SDK hook.
        </p>

        <h2 id="how-flags-work">How feature flags work</h2>
        <p>Each flag is a named capability (e.g. <code>analytics:export</code>) bound to a minimum tier level. The SDK checks the subscriber&apos;s current on-chain plan tier against the flag&apos;s required tier to determine access.</p>

        <div className="docs-lifecycle">
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-name" style={{ fontWeight: 700, marginBottom: 8 }}>1. Flag defined</div>
            <div className="docs-lifecycle-desc">Provider creates a flag in the dashboard: <strong>Catalog → Feature Flags → New Flag</strong>. Assigns it to a plan tier minimum.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-name" style={{ fontWeight: 700, marginBottom: 8 }}>2. Stored on-chain</div>
            <div className="docs-lifecycle-desc">Flag config is written to a Tableland table owned by the provider. The table is publicly readable and tamper-evident.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-name" style={{ fontWeight: 700, marginBottom: 8 }}>3. Evaluated by SDK</div>
            <div className="docs-lifecycle-desc">At runtime, <code>useFeatureFlag(key)</code> fetches the subscriber&apos;s tier from <code>SubscriptionRegistry</code> and compares against the flag config.</div>
          </div>
        </div>

        <h2 id="react-sdk">React SDK</h2>
        <CodeBlock lang="TypeScript" code={`import { useFeatureFlag, useSubscription } from '@meap/react';

function ExportButton() {
  // Check a single flag
  const { enabled, isLoading } = useFeatureFlag('analytics:export');

  if (isLoading) return null;
  if (!enabled) return <UpgradePrompt feature="analytics:export" />;

  return <button onClick={exportData}>Export CSV</button>;
}

function Dashboard() {
  // Check multiple flags at once
  const { flags } = useFeatureFlags([
    'analytics:export',
    'api:custom-webhooks',
    'seats:unlimited',
  ]);

  return (
    <nav>
      {flags['analytics:export'] && <ExportButton />}
      {flags['api:custom-webhooks'] && <WebhookSettings />}
    </nav>
  );
}`} />

        <h2 id="flag-config">Flag configuration schema</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>key</code></td><td>string</td><td>Unique flag identifier (e.g. <code>analytics:export</code>). Use <code>namespace:feature</code> convention.</td></tr>
            <tr><td><code>name</code></td><td>string</td><td>Human-readable display name shown in the dashboard.</td></tr>
            <tr><td><code>minimumTier</code></td><td>string</td><td>Plan tier required. Must match a <code>tier</code> field on an active plan (e.g. <code>&quot;pro&quot;</code>, <code>&quot;enterprise&quot;</code>).</td></tr>
            <tr><td><code>enabled</code></td><td>boolean</td><td>Global kill-switch. When false, flag is blocked for all tiers.</td></tr>
            <tr><td><code>defaultValue</code></td><td>boolean</td><td>Value returned when no subscription is found (default: <code>false</code>).</td></tr>
          </tbody>
        </table>

        <h2 id="server-side">Server-side verification</h2>
        <p>Never trust client-side flag evaluation alone for sensitive features. Verify on the server using the Node SDK:</p>
        <CodeBlock lang="TypeScript" code={`import { createMEAPClient } from '@meap/node';

const meap = createMEAPClient({
  registryAddress: '0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4',
  rpcUrl: process.env.RPC_URL,
});

// In your API route / middleware
export async function checkFeature(walletAddress: string, flagKey: string) {
  const { enabled } = await meap.featureFlags.evaluate({
    wallet: walletAddress,
    flag: flagKey,
  });

  return enabled; // true | false
}

// Usage
app.get('/api/export', async (req, res) => {
  const { wallet } = req.auth;
  const canExport = await checkFeature(wallet, 'analytics:export');

  if (!canExport) {
    return res.status(403).json({ error: 'Upgrade required' });
  }

  // ... handle export
});`} />

        <h2 id="lit-protocol">Advanced: Lit Protocol ACCs</h2>
        <p>
          For premium content that must remain encrypted (e.g. API keys, premium datasets), ArcenPay integrates with
          <strong> Lit Protocol</strong>. Content is encrypted and only decrypted when a subscriber&apos;s wallet satisfies the
          Access Control Conditions — verified via MPC nodes reading the on-chain <code>SubscriptionRegistry</code>.
        </p>
        <CodeBlock lang="JavaScript" code={`const accessControlConditions = [
  {
    contractAddress: '0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4',
    standardContractType: 'ERC721',
    chain: 'sepolia',
    method: 'hasActiveSubscription',
    parameters: [':userAddress'],
    returnValueTest: {
      comparator: '=',
      value: 'true',
    },
  },
];

// Encrypt content — only subscribers can decrypt
const { ciphertext, dataToEncryptHash } = await LitJsSdk.encryptString(
  { accessControlConditions, dataToEncrypt: 'secret-api-key-here' },
  litNodeClient,
);`} />

        <h2 id="tableland">Tableland storage</h2>
        <p>Feature flag configurations are stored in a Tableland SQL table. The table is mutable only by the provider multi-sig, making the flag state auditable and permanent.</p>
        <CodeBlock lang="SQL" code={`CREATE TABLE feature_flags_11155111 (
  id         INTEGER PRIMARY KEY,
  key        TEXT    NOT NULL UNIQUE,
  name       TEXT    NOT NULL,
  min_tier   TEXT    NOT NULL,
  enabled    INTEGER NOT NULL DEFAULT 1,
  default_v  INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);`} />
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#feature-flags">Feature flags</a></li>
          <li className="docs-toc-item"><a href="#how-flags-work">How flags work</a></li>
          <li className="docs-toc-item"><a href="#react-sdk">React SDK</a></li>
          <li className="docs-toc-item"><a href="#flag-config">Flag config schema</a></li>
          <li className="docs-toc-item"><a href="#server-side">Server-side verification</a></li>
          <li className="docs-toc-item"><a href="#lit-protocol">Lit Protocol ACCs</a></li>
          <li className="docs-toc-item"><a href="#tableland">Tableland storage</a></li>
        </ul>
      </nav>
    </div>
  );
}
