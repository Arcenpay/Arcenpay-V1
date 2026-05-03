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

export default function ApiPlansPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">API Reference</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Plans API</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="plans">
          Use the Plans API to list and retrieve the recurring offers you have
          already configured in the ArcenPay dashboard.
        </p>

        <h2 id="list">List plans</h2>
        <div className="api-endpoint badge-get">GET /api/v1/plans</div>
        <CodeBlock lang="bash" code={`curl https://dashboard.arcenpay.xyz/api/v1/plans \
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`} />

        <h3 style={{ marginTop: 24 }}>Response</h3>
        <CodeBlock lang="json" code={`{
  "data": [
    {
      "id": "starter-monthly",
      "name": "Starter Monthly",
      "tier": "starter",
      "price": "29.00",
      "currency": "USDC",
      "interval": "month",
      "active": true
    }
  ]
}`} />

        <h2 id="retrieve">Retrieve a plan</h2>
        <div className="api-endpoint badge-get">GET /api/v1/plans/:id</div>
        <CodeBlock lang="bash" code={`curl https://dashboard.arcenpay.xyz/api/v1/plans/starter-monthly \
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`} />

        <h2 id="object">Plan object</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Your plan identifier.</td></tr>
            <tr><td><code>name</code></td><td>Customer-facing name for the plan.</td></tr>
            <tr><td><code>tier</code></td><td>Entitlement tier associated with the plan.</td></tr>
            <tr><td><code>price</code></td><td>Recurring amount displayed to the customer.</td></tr>
            <tr><td><code>interval</code></td><td>Billing cadence such as <code>month</code> or <code>year</code>.</td></tr>
            <tr><td><code>active</code></td><td>Whether new customers can subscribe to the plan.</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#plans">Plans API</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#list">List plans</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#retrieve">Retrieve</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#object">Plan object</a></li>
        </ul>
      </nav>
    </div>
  );
}
