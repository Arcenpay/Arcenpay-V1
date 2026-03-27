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

export default function CustomerPortalPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Features</div>
        <div className="docs-page-title-row"><h1>Customer Portal</h1></div>

        <p className="docs-lead" id="customer-portal">
          ArcenPay provides a self-service customer portal where users can manage their subscriptions, 
          view transaction history, and upgrade/downgrade plans without contacting support.
        </p>

        <h2 id="embedded-portal">Embedded Portal</h2>
        <p>
          You can embed the portal directly into your application settings page using the <code>Portal</code> component.
        </p>
        <CodeBlock lang="tsx" code={`import { Portal } from '@arcenpay/react';

function AccountSettings() {
  return (
    <div className="settings-container">
      <h2>Billing Settings</h2>
      <Portal />
    </div>
  );
}
`} />

        <h2 id="portal-features">Portal features</h2>
        <ul>
          <li><strong>Current Plan:</strong> Shows active tier, price, and renewal date (sourced from ERC-5643).</li>
          <li><strong>Renewal Management:</strong> Toggle automatic renewals (module enable/disable).</li>
          <li><strong>Plan Switching:</strong> Seamlessly upgrade or downgrade to other plans from the same provider.</li>
          <li><strong>History:</strong> List of all on-chain billing events for that specific wallet.</li>
          <li><strong>NFT View:</strong> Displays the Subscription NFT metadata and technical proof of access.</li>
        </ul>

        <h2 id="hosted-portal">Hosted Portal</h2>
        <p>
          Every provider gets a dedicated hosted portal URL if they don&apos;t want to build an internal settings page.
        </p>
        <CodeBlock lang="text" code={`https://portal.arcenpay.com/p/{provider_address}`} />

        <h2 id="custom-management">Custom Management</h2>
        <p>If you want to build your own portal UI, use the <code>useSubscription</code> hook to get all the raw data:</p>
        <CodeBlock lang="tsx" code={`const { 
  subscription, 
  renew, 
  cancel, 
  isOwner 
} = useSubscription();

return (
  <div>
    <p>Expires: {new Date(subscription.expiresAt * 1000).toLocaleDateString()}</p>
    <button onClick={renew}>Renew Manually</button>
    <button onClick={cancel}>Cancel Subscription</button>
  </div>
);`} />

        <div className="docs-callout warning">
          <span className="docs-callout-icon">⚠️</span>
          <div>
            Cancelling in the portal sets the NFT expiry to &quot;now&quot;. It does <strong>not</strong> refund the 
            remaining time, as all ArcenPay subscriptions are non-custodial and final once confirmed on-chain.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#customer-portal">Customer Portal</a></li>
          <li className="docs-toc-item"><a href="#embedded-portal">Embedded Portal</a></li>
          <li className="docs-toc-item"><a href="#portal-features">Features</a></li>
          <li className="docs-toc-item"><a href="#hosted-portal">Hosted Portal</a></li>
          <li className="docs-toc-item"><a href="#custom-management">Custom UI</a></li>
        </ul>
      </nav>
    </div>
  );
}
