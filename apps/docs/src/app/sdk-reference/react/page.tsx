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
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Integrate</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>React SDK</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="react-sdk">
          <code>@arcenpay/react</code> is the main customer-facing SDK. Use it
          for recurring subscription checkout, hosted payment-link redirects,
          embedded billing surfaces, feature-flag checks, usage tracking, and
          entitlement-aware UI.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query`} />

        <h2 id="setup">Setup</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Wrap your application in <code>ArcenPayProvider</code> and pass a
          short-lived access token from your backend.
        </p>
        <CodeBlock lang="tsx" code={`import { ArcenPayProvider } from '@arcenpay/react';

function App({ accessToken }: { accessToken: string }) {
  return (
    <ArcenPayProvider
      chainId={84532}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
      token={accessToken}
    >
      <YourAppContent />
    </ArcenPayProvider>
  );
}`} />

        <h2 id="components">Core components</h2>

        <h3>PricingTable</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Render published plans and let the customer choose which subscription to start.</p>
        <CodeBlock lang="tsx" code={`<PricingTable
  providerAddress="0xYourTreasuryWallet"
  onSelectPlan={(planId) => setSelectedPlan(planId)}
/>`} />

        <h3>CheckoutModal</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Open recurring subscription checkout for a selected plan.</p>
        <CodeBlock lang="tsx" code={`<CheckoutModal
  planId={1n}
  isOpen={showCheckout}
  onClose={() => setShowCheckout(false)}
  activationEndpoint="/api/v1/subscriptions/activate"
/>`} />

        <h3>InvoiceList</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Display customer-facing billing history and invoice downloads.</p>
        <CodeBlock lang="tsx" code={`<InvoiceList providerUrl="https://api.yourapp.com" />`} />

        <h2 id="embedded-components">Embedded components</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use <code>ArcenEmbed</code> when you want a branded, self-serve
          billing surface backed by a dashboard-managed component definition and
          a short-lived embed access token.
        </p>
        <CodeBlock lang="tsx" code={`<ArcenEmbed
  accessToken={embedToken}
  componentId="cmp_123"
  baseUrl="https://dashboard.arcenpay.xyz"
  initialView="portal"
  onPlanChange={(planId) => console.log('switched', planId)}
/>`} />

        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          For lightweight template-driven surfaces, use
          <code>TemplateRenderer</code> with saved JSON blocks.
        </p>
        <CodeBlock lang="tsx" code={`<TemplateRenderer
  name="starter-plan"
  blocks={[
    { type: 'heading', content: 'Starter' },
    { type: 'price', amount: '$19', interval: '/month' },
    { type: 'feature-list', items: ['1 seat', 'Usage dashboard'] },
    { type: 'cta', content: 'Start trial', href: '/signup' },
  ]}
/>`} />

        <h2 id="hooks">Public hooks</h2>

        <h3>useEntitlementCheck</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Check whether a feature is enabled for the current customer context.</p>
        <CodeBlock lang="tsx" code={`const { enabled, loading } = useEntitlementCheck('analytics_export');

if (loading) return null;
if (!enabled) return <UpgradePrompt />;
return <ExportButton />;`} />

        <h3>useEntitlement</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Read the current wallet's plan tier, subscription state, and resolved features.</p>
        <CodeBlock lang="tsx" code={`const { planTier, isSubscribed, features } = useEntitlement(address);

if (!isSubscribed) return <UpgradePrompt />;
return <Dashboard tier={planTier} features={features} />;`} />

        <h3>useConsumeEntitlement</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Track usage-based consumption for a feature or metered capability.</p>
        <CodeBlock lang="tsx" code={`const { consume } = useConsumeEntitlement();

const result = await consume('scan');
if (!result.consumed) {
  alert(result.reason);
}`} />

        <h3>useFlag / useFlags</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Resolve dashboard-managed feature flags for a company or user.</p>
        <CodeBlock lang="tsx" code={`const exportFlag = useFlag(
  'analytics_export',
  { id: 'company_123' },
  { wallet: address }
);

const { flags } = useFlags(
  ['analytics_export', 'team_collaboration'],
  { id: 'company_123' }
);`} />

        <h3>useCompanyEntitlements</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Read the full entitlement map in one request when you need limits and allocations together.</p>
        <CodeBlock lang="tsx" code={`const { entitlements, loading } = useCompanyEntitlements(
  { id: 'company_123' }
);`} />

        <h3>useTrack</h3>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Send product usage events into ArcenPay when your pricing depends on tracked activity.</p>
        <CodeBlock lang="tsx" code={`const { track } = useTrack();

await track({
  event: 'document.scan.completed',
  featureKey: 'scan',
  quantity: 1,
});`} />

        <h2 id="hosted-payments">Hosted payment links</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use the helper below when you already created a payment link in the dashboard
          and want to send the customer into the hosted one-time checkout.
        </p>
        <CodeBlock lang="tsx" code={`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const url = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(url);`} />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#react-sdk">React SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#installation">Installation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#components">Components</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#embedded-components">Embedded components</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hooks">Hooks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hosted-payments">Hosted payments</a></li>
        </ul>
      </nav>
    </div>
  );
}
