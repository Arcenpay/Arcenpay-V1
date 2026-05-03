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
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Core Features</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Customer Portal</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="customer-portal">
          A customer portal gives people a self-serve place to review billing,
          download invoices, and understand what plan or add-ons they currently have.
        </p>

        <h2 id="building-blocks">Recommended building blocks</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>BillingHistory:</strong> show past subscription and payment activity.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>InvoiceList:</strong> let customers review and download invoices.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>CheckoutModal:</strong> let customers start or upgrade recurring plans.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Hosted payment links:</strong> collect one-time balances or invoice payments.</li>
        </ul>

        <h2 id="billing-history">Billing history</h2>
        <CodeBlock lang="tsx" code={`import { BillingHistory, InvoiceList } from '@arcenpay/react';

function BillingCenter() {
  return (
    <div>
      <BillingHistory />
      <InvoiceList providerUrl="https://api.yourapp.com" />
    </div>
  );
}`} />

        <h2 id="entitlement-status">Current access state</h2>
        <CodeBlock lang="tsx" code={`import { useEntitlement } from '@arcenpay/react';
import { useAccount } from 'wagmi';

function CurrentPlan() {
  const { address } = useAccount();
  const { planTier, isSubscribed } = useEntitlement(address);

  return <p>{isSubscribed ? 'Active plan: ' + planTier : 'No active subscription'}</p>;
}`} />

        <h2 id="upgrades">Upgrade and pay-now actions</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use <code>CheckoutModal</code> for recurring upgrades and hosted payment-link URLs
          when you need a one-time collection path.
        </p>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#customer-portal">Customer Portal</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#building-blocks">Building blocks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#billing-history">Billing history</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#entitlement-status">Current access</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#upgrades">Upgrade actions</a></li>
        </ul>
      </nav>
    </div>
  );
}
