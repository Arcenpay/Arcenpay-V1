"use client";
import { useState } from "react";

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
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function QuickstartPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row">
          <h1>Quickstart</h1>
        </div>

        <p className="docs-lead" id="quickstart">
          This guide gets you from zero to a working checkout + entitlement gate
          in one pass. Follow these steps in order, then use webhooks and server
          verification to harden for production.
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <div>
            <strong>Prerequisites:</strong> You need a provider account in the
            dashboard, at least one published paid plan with an on-chain plan
            ID, and a wallet on Sepolia.
          </div>
        </div>

        <h2 id="build-flow">Build flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Create and publish plans</div>
              <p className="docs-step-desc">
                Create free and paid plans in Catalog, then register paid plans
                on-chain so checkout can activate subscriptions.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Wire provider + pricing UI</div>
              <p className="docs-step-desc">
                Install SDK packages, mount <code>ArcenPayProvider</code>, and
                render your pricing table.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Open checkout and activate</div>
              <p className="docs-step-desc">
                Open checkout modal, call your activation endpoint, and refresh
                billing state after success.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Gate features server-side</div>
              <p className="docs-step-desc">
                Verify active subscriptions from backend routes before returning
                protected data.
              </p>
            </div>
          </div>
        </div>

        <h2 id="step-1-deploy-a-plan">Step 1 — Deploy a plan</h2>
        <p>
          In Dashboard, go to <strong>Catalog → Plans</strong>. Create your free
          baseline and at least one paid plan, publish them, then run
          register-on-chain for paid tiers.
        </p>
        <p>
          Your UI will only show paid plans as purchasable when each one has a
          valid <code>onChainPlanId</code>.
        </p>

        <h2 id="step-2-install">Step 2 — Install the SDK</h2>
        <CodeBlock
          lang="bash"
          code={`npm install @arcenpay/react @arcenpay/sdk viem wagmi`}
        />

        <h2 id="step-3-wrap-app">Step 3 — Wrap your app</h2>
        <p>
          Add <code>ArcenPayProvider</code> inside your wallet provider. Keep
          chain configuration in env vars and avoid hardcoding addresses.
        </p>
        <CodeBlock
          lang="TypeScript"
          code={`// app/providers.tsx
'use client';
import { ArcenPayProvider } from '@arcenpay/react';
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
      <ArcenPayProvider
        planFactoryAddress={process.env.NEXT_PUBLIC_PLAN_FACTORY_ADDRESS!}
        registryAddress={process.env.NEXT_PUBLIC_REGISTRY_ADDRESS!}
        chainId={Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '11155111')}
      >
        {children}
      </ArcenPayProvider>
    </WagmiProvider>
  );
}`}
        />

        <h2 id="step-4-pricing-table">Step 4 — Add a pricing table</h2>
        <CodeBlock
          lang="TypeScript"
          code={`// app/pricing/page.tsx
'use client';
import { PricingTable, CheckoutModal } from '@arcenpay/react';
import { useState } from 'react';

export default function PricingPage() {
  const [selectedPlanId, setSelectedPlanId] = useState<bigint | null>(null);

  return (
    <main>
      <h1>Choose a plan</h1>

      <PricingTable
        planIds={[1n, 2n, 3n]}
        highlightedPlanId={2n}
        onSelectPlan={(id) => setSelectedPlanId(id)}
      />

      <CheckoutModal
        planId={selectedPlanId}
        open={selectedPlanId !== null}
        onClose={() => setSelectedPlanId(null)}
        onSuccess={(txHash) => {
          console.log('Subscribed! Transaction:', txHash);
          setSelectedPlanId(null);
        }}
      />
    </main>
  );
}`}
        />

        <h2 id="step-5-gate-content">Step 5 — Gate content</h2>
        <p>
          Use <code>useSubscription</code> in client surfaces for UX, then
          enforce server checks for real protection.
        </p>
        <CodeBlock
          lang="TypeScript"
          code={`// components/PremiumFeature.tsx
'use client';
import { useSubscription } from '@arcenpay/react';

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
      {/* Premium content */}
    </div>
  );
}`}
        />

        <h2 id="step-6-verify-server-side">
          Step 6 — Verify subscriptions server-side
        </h2>
        <p>
          Never trust client-only state for sensitive APIs. Verify the wallet
          subscription in backend routes before returning protected data.
        </p>
        <CodeBlock
          lang="TypeScript"
          code={`// app/api/premium/route.ts
import { createArcenPayClient } from '@arcenpay/node';

const meap = createArcenPayClient({
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

  return Response.json({ data: getPremiumData(tier) });
}`}
        />

        <h2 id="env-vars">Environment variables</h2>
        <CodeBlock
          lang="bash"
          code={`# .env.local

# Sepolia testnet defaults
NEXT_PUBLIC_PLAN_FACTORY_ADDRESS=0x18707519A062AbCC3E73fBd4150C3B30B241f536
NEXT_PUBLIC_REGISTRY_ADDRESS=0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4
NEXT_PUBLIC_CHAIN_ID=11155111

# Server-side RPC (private endpoint in production)
RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
PLAN_FACTORY_ADDRESS=0x18707519A062AbCC3E73fBd4150C3B30B241f536
REGISTRY_ADDRESS=0xA0Cf798816D4b9b9866b5704098F9C09F279c2C4`}
        />

        <h2 id="production-checklist">Production checklist</h2>
        <ul>
          <li>
            All paid published plans have on-chain IDs and are purchasable
          </li>
          <li>
            Webhook endpoint is configured and signature verification enabled
          </li>
          <li>
            Server routes enforce entitlement checks for protected resources
          </li>
          <li>
            Customer portal reflects live billing state after activation and
            cancel
          </li>
          <li>Retry + idempotency are enabled for billing event processing</li>
        </ul>

        <div className="docs-callout tip">
          <span className="docs-callout-icon">
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <div>
            <strong>Done!</strong> Your app now has on-chain subscription
            billing. Next, explore{" "}
            <a href="/core-concepts/plans" style={{ color: "var(--accent)" }}>
              Plans
            </a>
            ,{" "}
            <a
              href="/core-concepts/feature-flags"
              style={{ color: "var(--accent)" }}
            >
              Feature Flags
            </a>
            , or the full{" "}
            <a href="/sdk-reference" style={{ color: "var(--accent)" }}>
              SDK Reference
            </a>
            .
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active">
            <a href="#quickstart">Quickstart</a>
          </li>
          <li className="docs-toc-item">
            <a href="#build-flow">Build flow</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-1-deploy-a-plan">1. Deploy a plan</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-2-install">2. Install SDK</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-3-wrap-app">3. Wrap your app</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-4-pricing-table">4. Add pricing table</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-5-gate-content">5. Gate content</a>
          </li>
          <li className="docs-toc-item">
            <a href="#step-6-verify-server-side">6. Server-side verify</a>
          </li>
          <li className="docs-toc-item">
            <a href="#env-vars">Environment variables</a>
          </li>
          <li className="docs-toc-item">
            <a href="#production-checklist">Production checklist</a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
