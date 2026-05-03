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

export default function ApiSubscriptionsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">API Reference</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Subscriptions API</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="subscriptions">
          Use the Subscriptions API to inspect customer billing status and keep
          your CRM, admin tools, or gated product access aligned with ArcenPay.
        </p>

        <h2 id="list">List subscriptions</h2>
        <div className="api-endpoint badge-get">GET /api/v1/subscriptions</div>
        <CodeBlock lang="bash" code={`curl https://dashboard.arcenpay.xyz/api/v1/subscriptions?customer=0xabc... \
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`} />

        <h2 id="verify">Verify a customer</h2>
        <div className="api-endpoint badge-get">GET /api/v1/verify/:wallet</div>
        <CodeBlock lang="bash" code={`curl https://dashboard.arcenpay.xyz/api/v1/verify/0xabc... \
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`} />

        <h3 style={{ marginTop: 24 }}>Response</h3>
        <CodeBlock lang="json" code={`{
  "valid": true,
  "subscription": {
    "id": "sub_123",
    "planId": "starter-monthly",
    "tier": "starter",
    "status": "active"
  }
}`} />

        <h2 id="cancel">Cancel a subscription</h2>
        <div className="api-endpoint badge-post">POST /api/v1/subscriptions/:id/cancel</div>
        <CodeBlock lang="bash" code={`curl -X POST https://dashboard.arcenpay.xyz/api/v1/subscriptions/sub_123/cancel \
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`} />

        <h2 id="object">Subscription object</h2>
        <table className="docs-table">
          <thead><tr><th>Field</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>id</code></td><td>Your subscription identifier.</td></tr>
            <tr><td><code>customer</code></td><td>Wallet address or customer identity tied to the subscription.</td></tr>
            <tr><td><code>planId</code></td><td>The active plan identifier.</td></tr>
            <tr><td><code>status</code></td><td>Current lifecycle state, such as <code>active</code> or <code>cancelled</code>.</td></tr>
          </tbody>
        </table>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#subscriptions">Subscriptions API</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#list">List subscriptions</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#verify">Verify</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#cancel">Cancel</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#object">Object</a></li>
        </ul>
      </nav>
    </div>
  );
}
