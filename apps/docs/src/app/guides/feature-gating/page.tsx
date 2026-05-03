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
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Guides</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Feature Gating</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="gating">
          Build entitlement-aware product experiences by combining dashboard-managed
          billing state with server-side checks in your app.
        </p>

        <h2 id="model">Recommended model</h2>
        <ol>
          <li>Resolve the customer identity in your backend.</li>
          <li>Check the relevant entitlement before returning protected data.</li>
          <li>Use the React SDK to reflect the same access state in the UI.</li>
          <li>Keep plan and add-on mapping in ArcenPay, not in scattered frontend conditionals.</li>
        </ol>

        <h2 id="api">Server-side gating</h2>
        <CodeBlock
          lang="ts"
          code={`await client.identify({
  company: { id: 'company_123' },
  user: { wallet: '0xabc...' },
});

const result = await client.checkEntitlement('priority_support');
if (!result.enabled) throw new Error('Upgrade required');`}
        />

        <h2 id="react">Client-side checks</h2>
        <CodeBlock
          lang="tsx"
          code={`import { useEntitlementCheck } from '@arcenpay/react';

function ExportButton() {
  const { enabled, loading } = useEntitlementCheck('analytics_export');

  if (loading) return null;
  if (!enabled) return <UpgradePrompt />;

  return <button>Export CSV</button>;
}`}
        />

        <h2 id="operational-notes">Operational notes</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use add-on grants for one-time unlocks instead of custom ad hoc flags in your own app DB.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Keep sensitive gating decisions on the server even if the UI hides locked controls.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use webhooks to react to plan changes, cancellations, and invoice payment events.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#gating">Feature Gating</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#model">Model</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#api">Server-side gating</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react">Client-side checks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#operational-notes">Operational notes</a></li>
        </ul>
      </nav>
    </div>
  );
}
