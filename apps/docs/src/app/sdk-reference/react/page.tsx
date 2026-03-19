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

export default function ReactSDKPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Integrate</div>
        <div className="docs-page-title-row"><h1>React SDK</h1></div>

        <p className="docs-lead" id="react-sdk">
          The <code>@meap/react</code> SDK is the primary tool for building customer-facing ArcenPay integrations.
          It provides high-level components for checkout and portals, and hooks for access control.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @meap/react wagmi viem @tanstack/react-query`} />

        <h2 id="setup">Setup</h2>
        <p>Wrap your application in the <code>MEAPProvider</code>. It requires a <code>wagmi</code> config.</p>
        <CodeBlock lang="tsx" code={`import { MEAPProvider } from '@meap/react';
import { config } from './wagmi';

function App() {
  return (
    <MEAPProvider config={config}>
      <YourAppContent />
    </MEAPProvider>
  );
}
`} />

        <h2 id="hooks">Hooks</h2>

        <h3>useSubscription</h3>
        <p>Returns the active subscription state for the connected wallet.</p>
        <CodeBlock lang="tsx" code={`const { 
  subscription, 
  status, // 'loading' | 'active' | 'expired' | 'none'
  plan,
  renew 
} = useSubscription();

if (status === 'active') {
  return <p>Welcome, {plan.tier} member!</p>;
}
`} />

        <h3>useCheckout</h3>
        <p>Programmatically trigger the ArcenPay checkout modal.</p>
        <CodeBlock lang="tsx" code={`const { startCheckout, loading, error } = useCheckout();

<button onClick={() => startCheckout(PLAN_ID)}>
  Buy Pro Plan
</button>`} />

        <h3>useFeatureFlags</h3>
        <p>Retrieve dynamic feature toggles based on the user&apos;s subscription tier.</p>
        <CodeBlock lang="tsx" code={`const { flags } = useFeatureFlags();

return (
  <div>
    {flags.beta_access && <BetaFeature />}
    <p>Storage Limit: {flags.storage_gb}GB</p>
  </div>
);`} />

        <h2 id="components">Components</h2>

        <h3>PricingTable</h3>
        <p>A ready-to-use pricing grid that pulls data directly from your on-chain plans.</p>
        <CodeBlock lang="tsx" code={`<PricingTable 
  planIds={[1, 2, 3]} 
  onSuccess={(receipt) => router.push('/dashboard')}
/>`} />

        <h3>CheckoutModal</h3>
        <p>A standalone modal for a specific plan. Use this if you have your own custom pricing cards.</p>
        <CodeBlock lang="tsx" code={`<CheckoutModal 
  planId={2} 
  isOpen={isOpen} 
  onClose={toggle} 
/>`} />

        <h3>Portal</h3>
        <p>An embedded customer portal for managing subscriptions.</p>
        <CodeBlock lang="tsx" code={`<Portal />`} />

        <h2 id="custom-themes">Custom themes</h2>
        <p>Style all components using the theme object in the provider.</p>
        <CodeBlock lang="tsx" code={`<MEAPProvider theme={{
  colors: {
    primary: '#2563eb',
    background: '#ffffff',
    text: '#111827'
  },
  borderRadius: 'md'
}}>
  {children}
</MEAPProvider>`} />

        <div className="docs-callout tip">
          <span className="docs-callout-icon">🚀</span>
          <div>
            Check out our <a href="/frameworks/nextjs">Next.js Guide</a> for server-side integration and RSC support.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#react-sdk">React SDK</a></li>
          <li className="docs-toc-item"><a href="#installation">Installation</a></li>
          <li className="docs-toc-item"><a href="#setup">Setup</a></li>
          <li className="docs-toc-item"><a href="#hooks">Hooks</a></li>
          <li className="docs-toc-item"><a href="#components">Components</a></li>
          <li className="docs-toc-item"><a href="#custom-themes">Themes</a></li>
        </ul>
      </nav>
    </div>
  );
}
