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

export default function StripeMigrationGuide() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Guides</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Migrate from Stripe</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="stripe">
          Move your recurring billing and invoice collection from Stripe to
          ArcenPay in stages so customers can keep using your product while you
          switch checkout and entitlement logic.
        </p>

        <h2 id="equivalents">Concept mapping</h2>
        <table className="docs-table">
          <thead><tr><th>Stripe</th><th>ArcenPay</th></tr></thead>
          <tbody>
            <tr><td>Product / Price</td><td>Plan</td></tr>
            <tr><td>Customer</td><td>Company + user identity</td></tr>
            <tr><td>Subscription</td><td>Recurring subscription</td></tr>
            <tr><td>Invoice payment link</td><td>Hosted payment link</td></tr>
            <tr><td>Webhooks</td><td>Signed ArcenPay webhooks</td></tr>
          </tbody>
        </table>

        <h2 id="step-1">1. Map your plans</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Recreate your paid tiers in the ArcenPay dashboard and store the new
          ArcenPay plan id next to your existing Stripe metadata during the transition.
        </p>

        <h2 id="step-2">2. Switch new checkout flows</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Send new customers through ArcenPay checkout while legacy subscriptions finish their current cycle.</p>
        <CodeBlock lang="tsx" code={`<CheckoutModal
  planId={selectedPlan}
  activationEndpoint="/api/v1/subscriptions/activate"
  onClose={() => setSelectedPlan(null)}
/>`} />

        <h2 id="step-3">3. Update access checks</h2>
        <CodeBlock lang="typescript" code={`await client.identify({
  company: { id: account.arcenCompanyId },
  user: { wallet: account.walletAddress },
});

const entitlement = await client.checkEntitlement('analytics_export');
const hasAccess = entitlement.enabled;`} />

        <h2 id="step-4">4. Migrate invoices and one-time charges</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Replace Stripe invoice links or ad hoc card charges with hosted ArcenPay
          payment links for setup fees, invoice collection, or one-time add-ons.
        </p>
        <CodeBlock lang="tsx" code={`import { createPaymentLinkCheckoutUrl } from '@arcenpay/react';

const url = createPaymentLinkCheckoutUrl(paymentLink.slug);
window.location.assign(url);`} />

        <div className="docs-callout-warning mb-5">
          <span className="docs-callout-icon">⚖️</span>
          <div>
            Plan for a customer communication step during migration. Users moving
            from card billing to wallet-based billing will need to complete one
            ArcenPay checkout to establish their new billing relationship.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#stripe">Stripe Migration</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#equivalents">Concept mapping</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-1">1. Map plans</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-2">2. Switch checkout</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-3">3. Access checks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#step-4">4. Payment links</a></li>
        </ul>
      </nav>
    </div>
  );
}
