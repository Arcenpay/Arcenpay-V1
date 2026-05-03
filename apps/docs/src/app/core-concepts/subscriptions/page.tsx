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

export default function SubscriptionsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Core Concepts</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Subscriptions</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="subscriptions">
          A subscription is the active customer relationship created after a
          successful recurring checkout. Your app should treat the server-side
          entitlement result as the source of truth for access.
        </p>

        <h2 id="lifecycle">Lifecycle</h2>
        <div className="docs-lifecycle">
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">Active</div>
            <div className="docs-lifecycle-name">Paying customer</div>
            <div className="docs-lifecycle-desc">The customer has a valid recurring subscription and should receive the attached plan entitlements.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge" style={{ background:'rgba(234,179,8,0.1)', color:'#92400e', border: '1px solid rgba(234,179,8,0.2)' }}>Past due</div>
            <div className="docs-lifecycle-name">Needs attention</div>
            <div className="docs-lifecycle-desc">Renewal or billing requires follow-up before the customer regains full access.</div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge archived">Cancelled</div>
            <div className="docs-lifecycle-name">Inactive</div>
            <div className="docs-lifecycle-desc">The subscription is no longer active for future billing and access should be restricted.</div>
          </div>
        </div>

        <h2 id="launch">Launch checkout</h2>
        <CodeBlock lang="tsx" code={`<CheckoutModal
  planId={selectedPlan}
  activationEndpoint="/api/v1/subscriptions/activate"
  onClose={() => setSelectedPlan(null)}
/>`} />

        <h2 id="react-check">Check access in React</h2>
        <CodeBlock lang="tsx" code={`const { enabled, loading } = useEntitlementCheck('analytics_export');

if (loading) return null;
if (!enabled) return <UpgradePrompt />;
return <AnalyticsDashboard />;`} />

        <h2 id="server-check">Check access on the server</h2>
        <CodeBlock lang="ts" code={`await client.identify({
  company: { id: 'company_123' },
  user: { wallet: '0xabc...' },
});

const entitlement = await client.checkEntitlement('analytics_export');`} />

        <h2 id="cancellation">Cancellation</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          When a customer cancels, update your product access from the latest
          entitlement result or webhook event rather than assuming a local UI state.
        </p>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#subscriptions">Subscriptions</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#lifecycle">Lifecycle</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#launch">Launch checkout</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react-check">React checks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#server-check">Server checks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#cancellation">Cancellation</a></li>
        </ul>
      </nav>
    </div>
  );
}
