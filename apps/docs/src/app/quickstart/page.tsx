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

export default function QuickstartPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row">
          <h1>Quickstart</h1>
        </div>

        <p className="docs-lead" id="quickstart">
          Get ArcenPay subscription billing running in your React app in under 10 minutes.
          This guide covers installing the SDK, wrapping your app with <code>MEAPProvider</code>,
          and adding a pricing table with a checkout flow.
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div>
            <strong>Prerequisites:</strong> You need a provider account on the ArcenPay dashboard, at least one deployed Plan,
            and a wallet connected to Sepolia ETH.
          </div>
        </div>

        <h2 id="step-1-deploy-a-plan">Step 1 — Deploy a plan</h2>
        <p>
          Before integrating the SDK, you need a plan deployed on-chain. Navigate to{' '}
          <strong>Catalog → Plans → Create Plan</strong> in the dashboard.
          Enter a name, price (USDC), and billing interval. Click <strong>Deploy Plan</strong> — MetaMask will prompt
          a <code>PlanFactory.createPlan()</code> transaction. Copy the returned <strong>Plan ID</strong>.
        </p>

        <h2 id="step-2-install">Step 2 — Install the SDK</h2>
        <CodeBlock lang="bash" code={`npm install @meap/react @meap/core viem wagmi`} />

        <h2 id="step-3-wrap-app">Step 3 — Wrap your app</h2>
        <p>Add <code>MEAPProvider</code> inside your Wagmi/wallet provider. Pass the deployed contract addresses for your chain.</p>
        <CodeBlock lang="TypeScript" code={`// app/providers.tsx
'use client';
import { MEAPProvider } from '@meap/react';
import { WagmiProvider, createConfig } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const config = createConfig({
  chains: [sepolia],
  connectors: [injected()],
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <MEAPProvider
        planFactoryAddress="0x18707519A062AbCC3E73fBd4150C3B30B241f536"
        registryAddress="0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4"
        chainId={11155111}
      >
        {children}
      </MEAPProvider>
    </WagmiProvider>
  );
}`} />

        <h2 id="step-4-pricing-table">Step 4 — Add a pricing table</h2>
        <CodeBlock lang="TypeScript" code={`// app/pricing/page.tsx
'use client';
import { PricingTable, CheckoutModal } from '@meap/react';
import { useState } from 'react';

export default function PricingPage() {
  const [selectedPlanId, setSelectedPlanId] = useState<bigint | null>(null);

  return (
    <main>
      <h1>Choose a Plan</h1>

      {/* Renders cards for each plan ID */}
      <PricingTable
        planIds={[1n, 2n, 3n]}            // Your plan IDs from Step 1
        highlightedPlanId={2n}            // Mark as "recommended"
        onSelectPlan={(id) => setSelectedPlanId(id)}
      />

      {/* Checkout modal */}
      <CheckoutModal
        planId={selectedPlanId}
        open={selectedPlanId !== null}
        onClose={() => setSelectedPlanId(null)}
        onSuccess={(txHash) => {
          console.log('Subscribed! Transaction:', txHash);
          setSelectedPlanId(null);
          // Redirect to dashboard, etc.
        }}
      />
    </main>
  );
}`} />

        <h2 id="step-5-gate-content">Step 5 — Gate content</h2>
        <p>Use the <code>useSubscription</code> hook anywhere in your app to check access:</p>
        <CodeBlock lang="TypeScript" code={`// components/PremiumFeature.tsx
'use client';
import { useSubscription } from '@meap/react';

export function PremiumFeature() {
  const { isActive, tier, expiresAt, isLoading } = useSubscription();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isActive) {
    return (
      <div>
        <p>This feature requires an active subscription.</p>
        <a href="/pricing">View plans →</a>
      </div>
    );
  }

  return (
    <div>
      <p>Welcome, {tier} subscriber!</p>
      <p>Access valid until: {new Date(expiresAt! * 1000).toLocaleDateString()}</p>
      {/* Premium content here */}
    </div>
  );
}`} />

        <h2 id="step-6-verify-server-side">Step 6 — Verify subscriptions server-side</h2>
        <p>Never trust client-side state for sensitive data. Verify the wallet&apos;s subscription in your API routes:</p>
        <CodeBlock lang="TypeScript" code={`// app/api/premium/route.ts
import { createMEAPClient } from '@meap/node';

const meap = createMEAPClient({
  planFactoryAddress: process.env.PLAN_FACTORY_ADDRESS!,
  registryAddress:    process.env.REGISTRY_ADDRESS!,
  rpcUrl:             process.env.RPC_URL!,
  chainId:            11155111,
});

export async function GET(request: Request) {
  const wallet = request.headers.get('x-wallet-address');
  if (!wallet) {
    return Response.json({ error: 'No wallet' }, { status: 401 });
  }

  const { isActive, tier } = await meap.subscriptions.verify({ wallet });
  if (!isActive) {
    return Response.json({ error: 'Subscription required' }, { status: 403 });
  }

  // Return premium data
  return Response.json({ data: getPremiumData(tier) });
}`} />

        <h2 id="env-vars">Environment variables</h2>
        <CodeBlock lang="bash" code={`# .env.local

# Contract addresses (Sepolia testnet)
NEXT_PUBLIC_PLAN_FACTORY_ADDRESS=0x18707519A062AbCC3E73fBd4150C3B30B241f536
NEXT_PUBLIC_REGISTRY_ADDRESS=0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4
NEXT_PUBLIC_CHAIN_ID=11155111

# Server-side RPC (use a private endpoint for production)
RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PLAN_FACTORY_ADDRESS=0x18707519A062AbCC3E73fBd4150C3B30B241f536
REGISTRY_ADDRESS=0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4`} />

        <div className="docs-callout tip">
          <span className="docs-callout-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" /><path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <div>
            <strong>Done!</strong> Your app now has on-chain subscription billing.
            Next, explore <a href="/core-concepts/plans" style={{ color: 'var(--accent)' }}>Plans</a>,
            {' '}<a href="/core-concepts/feature-flags" style={{ color: 'var(--accent)' }}>Feature Flags</a>,
            {' '}or the full <a href="/sdk-reference" style={{ color: 'var(--accent)' }}>SDK Reference</a>.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#quickstart">Quickstart</a></li>
          <li className="docs-toc-item"><a href="#step-1-deploy-a-plan">1. Deploy a plan</a></li>
          <li className="docs-toc-item"><a href="#step-2-install">2. Install SDK</a></li>
          <li className="docs-toc-item"><a href="#step-3-wrap-app">3. Wrap your app</a></li>
          <li className="docs-toc-item"><a href="#step-4-pricing-table">4. Add pricing table</a></li>
          <li className="docs-toc-item"><a href="#step-5-gate-content">5. Gate content</a></li>
          <li className="docs-toc-item"><a href="#step-6-verify-server-side">6. Server-side verify</a></li>
          <li className="docs-toc-item"><a href="#env-vars">Environment variables</a></li>
        </ul>
      </nav>
    </div>
  );
}
