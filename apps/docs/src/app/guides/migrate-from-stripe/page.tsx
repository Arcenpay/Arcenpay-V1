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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Guides</div>
        <div className="docs-page-title-row"><h1>Migrate from Stripe</h1></div>

        <p className="docs-lead" id="stripe">
          A step-by-step technical guide for moving your existing Stripe-based billing logic to ArcenPay NFTs.
        </p>

        <h2 id="equivalents">Technical equivalents</h2>
        <table className="docs-table">
          <thead><tr><th>Stripe Object</th><th>ArcenPay Equivalent</th></tr></thead>
          <tbody>
            <tr><td>Product / Price</td><td>Plan</td></tr>
            <tr><td>Customer</td><td>Wallet Address</td></tr>
            <tr><td>Subscription</td><td>Subscription NFT (ERC-5643)</td></tr>
            <tr><td>Invoice</td><td>Billing Event Log</td></tr>
            <tr><td>Webhooks</td><td>On-chain Events / Webhooks</td></tr>
          </tbody>
        </table>

        <h2 id="step-1">1. Mapping IDs</h2>
        <p>
          Store an <code>arcenpay_plan_id</code> alongside your Stripe <code>price_id</code> in your database. 
          This allows you to support dual-billing during the transition.
        </p>

        <h2 id="step-2">2. The Checkout Switch</h2>
        <p>Replace the Stripe Checkout redirection with the ArcenPay modal.</p>
        <CodeBlock lang="diff" code={`- const { url } = await stripe.checkout.sessions.create({...});
- window.location.href = url;
+ const { startCheckout } = useCheckout();
+ startCheckout(planId);`} />

        <h2 id="step-3">3. Verifying Access</h2>
        <CodeBlock lang="typescript" code={`// Before:
const user = await db.user.findUnique({ where: { id } });
const isActive = user.stripeStatus === 'active';

// After:
const { isValid } = await client.verifySubscription(user.wallet);
const isWeb3Active = isValid;`} />

        <h2 id="step-4">4. Batch Airdropping (Legacy Users)</h2>
        <p>
          To move existing Stripe customers to ArcenPay without charging them again, 
          use the <code>mintBatch</code> function to airdrop NFTs to their wallets for the remainder 
          of their current Stripe period.
        </p>
        <CodeBlock lang="typescript" code={`const legacyUsers = await db.user.findMany({ where: { isPro: true } });
const addresses = legacyUsers.map(u => u.wallet);

await registry.mintBatch(addresses, PRO_PLAN_ID, ONE_MONTH);`} />

        <div className="docs-callout warning">
          <span className="docs-callout-icon">⚖️</span>
          <div>
            Note: You cannot &quot;import&quot; credit cards from Stripe to ArcenPay. Users must 
            manually sign a transaction once to enable their first On-chain subscription.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#stripe">Stripe Migration</a></li>
          <li className="docs-toc-item"><a href="#equivalents">Equivalents</a></li>
          <li className="docs-toc-item"><a href="#step-1">1. Mapping</a></li>
          <li className="docs-toc-item"><a href="#step-2">2. Checkout</a></li>
          <li className="docs-toc-item"><a href="#step-3">3. Verification</a></li>
          <li className="docs-toc-item"><a href="#step-4">4. Airdropping</a></li>
        </ul>
      </nav>
    </div>
  );
}
