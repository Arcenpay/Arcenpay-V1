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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Guides</div>
        <div className="docs-page-title-row"><h1>SaaS Subscription Wall</h1></div>

        <p className="docs-lead" id="saas-wall">
          Learn how to implement a professional subscription-gated SaaS application using ArcenPay and Next.js.
        </p>

        <h2 id="architecture">The Architecture</h2>
        <p>
          We use a hybrid approach: Client-side gating for UI responsiveness (hiding/showing elements) and 
          Server-side gating (Middleware) for security (protecting sensitive data).
        </p>

        <h2 id="step-1">Step 1: Define your tiers</h2>
        <p>In the ArcenPay Dashboard, create two plans:</p>
        <ul>
          <li><strong>Free:</strong> $0/month (Optional, or just no NFT).</li>
          <li><strong>Pro:</strong> $29/month.</li>
        </ul>

        <h2 id="step-2">Step 2: Protecting Routes</h2>
        <p>Create a <code>ProtectedRoute</code> component that wraps sensitive pages.</p>
        <CodeBlock lang="tsx" code={`"use client";
import { useSubscription } from '@arcenpay/react';
import { useRouter } from 'next/navigation';

export default function ProtectedRoute({ children, tier = 'pro' }) {
  const { status, plan, loading } = useSubscription();
  const router = useRouter();

  if (loading) return <div>Loading...</div>;

  if (status !== 'active' || (tier && plan.tier !== tier)) {
    router.push('/pricing');
    return null;
  }

  return children;
}`} />

        <h2 id="step-3">Step 3: Handling Renewals</h2>
        <p>
          Since ArcenPay uses ERC-5643, your app should listen for the &quot;expired&quot; state and show a 
          top-bar alert when the renewal fails or the user needs to add funds.
        </p>
        <CodeBlock lang="tsx" code={`const { status, renew } = useSubscription();

{status === 'expired' && (
  <div className="alert">
    Your subscription expired. <button onClick={renew}>Renew Now</button>
  </div>
)}`} />

        <h2 id="step-4">Step 4: Webhook Sync</h2>
        <p>
          Sync subscription events to your internal database (e.g. Supabase or Prisma) to track 
          customer lifetime value (LTV).
        </p>
        <CodeBlock lang="typescript" code={`// api/webhooks/route.ts
if (event.type === 'subscription.created') {
  await db.user.update({
    where: { wallet: event.data.subscriber },
    data: { isPro: true, expiry: event.data.newExpiration }
  });
}`} />

        <div className="docs-callout tip">
          <span className="docs-callout-icon">💡</span>
          <div>
            You can use the <code>PricingTable</code> component to build your pricing page in seconds.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#saas-wall">SaaS Wall</a></li>
          <li className="docs-toc-item"><a href="#architecture">Architecture</a></li>
          <li className="docs-toc-item"><a href="#step-1">1. Tiers</a></li>
          <li className="docs-toc-item"><a href="#step-2">2. Routes</a></li>
          <li className="docs-toc-item"><a href="#step-3">3. Renewals</a></li>
          <li className="docs-toc-item"><a href="#step-4">4. Sync</a></li>
        </ul>
      </nav>
    </div>
  );
}
