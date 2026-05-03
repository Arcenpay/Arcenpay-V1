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

export default function PlansPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Core Concepts</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Plans</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="plans">
          A plan is your recurring offer in ArcenPay. It defines what the
          customer is buying, how often they are billed, and which entitlements
          should unlock after checkout.
        </p>

        <h2 id="creating">Create a plan</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Open the Catalog</div>
              <p className="docs-step-desc">Go to the dashboard Catalog and create a new recurring plan.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Define the commercial terms</div>
              <p className="docs-step-desc">Choose the plan name, price, billing cadence, and customer-facing description.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Attach access rules</div>
              <p className="docs-step-desc">Map the plan to the features, quotas, or product access your app should unlock.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Publish and reuse the plan id</div>
              <p className="docs-step-desc">Use the published plan in your checkout UI, API calls, and entitlement checks.</p>
            </div>
          </div>
        </div>

        <h2 id="fields">What a plan usually contains</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Field</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr><td>Name</td><td>Customer-facing plan label such as Starter, Pro, or Enterprise.</td></tr>
            <tr><td>Price</td><td>The recurring amount billed each cycle.</td></tr>
            <tr><td>Interval</td><td>Monthly, quarterly, annual, or another supported cadence.</td></tr>
            <tr><td>Feature mapping</td><td>The product access or usage allowance unlocked after payment.</td></tr>
            <tr><td>Status</td><td>Whether the plan is available for new subscriptions.</td></tr>
          </tbody>
        </table>

        <h2 id="react">Use a plan in checkout</h2>
        <CodeBlock lang="tsx" code={`<CheckoutModal
  planId={1n}
  isOpen={!!selectedPlan}
  activationEndpoint="/api/v1/subscriptions/activate"
  onClose={() => setSelectedPlan(null)}
/>`} />

        <h2 id="api">Example plan response</h2>
        <CodeBlock lang="json" code={`{
  "id": "starter-monthly",
  "name": "Starter Monthly",
  "tier": "starter",
  "currency": "USDC",
  "price": "29.00",
  "interval": "month",
  "active": true
}`} />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#plans">Plans</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#creating">Create a plan</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#fields">Fields</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react">Checkout</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#api">Example response</a></li>
        </ul>
      </nav>
    </div>
  );
}
