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

export default function SubscriptionWallGuide() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Guides</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>SaaS Subscription Wall</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="saas-wall">
          A strong subscription wall uses server-side entitlement checks for
          protected data and client-side checks for a smooth product experience.
        </p>

        <h2 id="model">Recommended structure</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use a hybrid approach: the backend decides whether access is allowed,
          while the frontend uses the React SDK to show upgrade prompts and hide
          unavailable controls.
        </p>

        <h2 id="step-1">1. Define your tiers</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">In the ArcenPay dashboard, create the plans your app wants to sell.</p>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Starter:</strong> entry tier for basic access.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Pro:</strong> paid tier for premium features.</li>
        </ul>

        <h2 id="step-2">2. Gate the UI</h2>
        <CodeBlock lang="tsx" code={`import { useEntitlementCheck } from '@arcenpay/react';

export function ProtectedPanel() {
  const { enabled, loading } = useEntitlementCheck('analytics_export');

  if (loading) return <div>Loading...</div>;
  if (!enabled) return <UpgradePrompt />;

  return <PremiumDashboard />;
}`} />

        <h2 id="step-3">3. Gate the API</h2>
        <CodeBlock lang="typescript" code={`await client.identify({
  company: { id: 'company_123' },
  user: { wallet: '0xabc...' },
});

const entitlement = await client.checkEntitlement('analytics_export');
if (!entitlement.enabled) {
  throw new Error('Upgrade required');
}`} />

        <h2 id="step-4">4. Sync billing state</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Process webhook events so your CRM, customer support tooling, and
          analytics stay aligned with subscription changes.
        </p>
        <CodeBlock lang="typescript" code={`if (event.event === 'invoice.paid') {
  await db.accounts.update({
    where: { arcenCompanyId: event.data.companyId },
    data: { billingStatus: 'active' },
  });
}`} />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#saas-wall">SaaS Wall</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#model">Model</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-1">1. Tiers</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-2">2. UI</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-3">3. API</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-4">4. Sync</a></li>
        </ul>
      </nav>
    </div>
  );
}
