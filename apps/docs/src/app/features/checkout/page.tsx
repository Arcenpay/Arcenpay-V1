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

export default function CheckoutPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Features</div>
        <div className="docs-page-title-row"><h1>Checkout & Modals</h1></div>

        <p className="docs-lead" id="checkout">
          The ArcenPay Checkout is an optimized, conversion-focused payment flow. It handles wallet connection,
          token approval, and subscription minting in a single cohesive UI.
        </p>

        <h2 id="checkout-components">Checkout components</h2>
        <p>The <code>@meap/react</code> SDK provides three ways to trigger checkout:</p>

        <h3>1. CheckoutModal</h3>
        <p>A pre-built overlay that opens when triggered. It handles the entire multi-step blockchain process.</p>
        <CodeBlock lang="tsx" code={`import { CheckoutModal } from '@meap/react';

<CheckoutModal 
  planId={1} 
  isOpen={isOpen} 
  onClose={() => setIsOpen(false)} 
  onSuccess={(receipt) => console.log('Paid!', receipt)}
/>`} />

        <h3>2. PricingTable</h3>
        <p>A full-featured pricing grid that displays your plans and includes &quot;Subscribe&quot; buttons that trigger the checkout flow.</p>
        <CodeBlock lang="tsx" code={`import { PricingTable } from '@meap/react';

<PricingTable 
  planIds={[1, 2, 3]} 
  highlightId={2} // "Pro" plan
/>`} />

        <h3>3. useCheckout hook</h3>
        <p>For custom UIs, use the hook to trigger the checkout programmatically.</p>
        <CodeBlock lang="tsx" code={`const { startCheckout, loading } = useCheckout();

<button onClick={() => startCheckout(planId)}>
  {loading ? 'Processing...' : 'Subscribe Now'}
</button>`} />

        <h2 id="checkout-flow">The Checkout Flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Wallet Connection</div>
              <p className="docs-step-desc">If no wallet is connected, the modal triggers the system-wide connector (Wagmi/ConnectKit/RainbowKit).</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Token Approval</div>
              <p className="docs-step-desc">If the user hasn&apos;t approved USDC, a &quot;Grant Permission&quot; transaction is requested for the <code>SubscriptionRegistry</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Subscription Minting</div>
              <p className="docs-step-desc">The final transaction executes <code>mint()</code>. The user is now officially a subscriber.</p>
            </div>
          </div>
        </div>

        <h2 id="customization">Customization</h2>
        <p>You can theme the checkout to match your brand via the <code>MEAPProvider</code>:</p>
        <CodeBlock lang="tsx" code={`<MEAPProvider config={{
  theme: {
    accentColor: '#4f46e5',
    borderRadius: '8px',
    fontFamily: 'Inter, sans-serif'
  }
}}>
  {children}
</MEAPProvider>`} />

        <h2 id="multi-currency">Multi-currency support</h2>
        <p>The checkout automatically detects which token the plan requires (USDC, USDT, or custom stables) and checks the user&apos;s balance before proceeding.</p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">ℹ️</span>
          <div>
            The checkout flow is fully gas-abstracted for users with ERC-7579 smart accounts. They can pay gas in USDC.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#checkout">Checkout & Modals</a></li>
          <li className="docs-toc-item"><a href="#checkout-components">Components</a></li>
          <li className="docs-toc-item"><a href="#checkout-flow">The Flow</a></li>
          <li className="docs-toc-item"><a href="#customization">Theme</a></li>
          <li className="docs-toc-item"><a href="#multi-currency">Currencies</a></li>
        </ul>
      </nav>
    </div>
  );
}
