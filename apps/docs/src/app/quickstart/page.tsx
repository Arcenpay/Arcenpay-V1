import DocImagePlaceholder from "../_components/DocImagePlaceholder";

export default function QuickstartPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">
          Getting Started
        </div>
        <div className="flex items-center justify-between gap-4 mb-3.5">
          <h1 className="text-[clamp(30px,4vw,42px)] font-bold tracking-[-0.04em] leading-tight">
            Platform Quickstart
          </h1>
        </div>

        <p
          className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]"
          id="quickstart"
        >
          This is the fastest supported way to add ArcenPay to your app. The
          main integration path uses only two public packages:
          <code> @arcenpay/react </code>
          for customer-facing UI and
          <code> @arcenpay/node </code>
          for secure backend workflows.
        </p>

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            Before you write code, finish the dashboard setup first: create your
            workspace, connect the wallet that should receive funds, publish at
            least one plan, and create a billing component if you want an
            embedded customer portal.
          </div>
        </div>

        <DocImagePlaceholder
          title="Dashboard Setup Overview"
          description="Add a screenshot here showing the dashboard areas a new integrator should configure first: workspace settings, plans, payment links, and the component builder."
          heightClassName="h-72"
        />

        <h2
          id="build-flow"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          Build flow
        </h2>
        <div className="docs-steps">
          {[
            {
              num: "1",
              title: "Install the two main SDKs",
              desc: "Use the React SDK for billing UI and the Node SDK for access tokens, activation, and webhook verification.",
            },
            {
              num: "2",
              title: "Create a backend access-token route",
              desc: "Use your server-side API key to identify the company or user and mint a short-lived token for the browser.",
            },
            {
              num: "3",
              title: "Wrap your app with ArcenPayProvider",
              desc: "Pass the short-lived token into the React SDK so portal surfaces, hooks, and checkout components have ArcenPay context.",
            },
            {
              num: "4",
              title: "Render checkout or the billing portal",
              desc: "Use CheckoutModal for recurring plan signup and ArcenEmbed for a dashboard-managed customer billing experience.",
            },
            {
              num: "5",
              title: "Verify access and sync events on the backend",
              desc: "Use ArcenClient for entitlement checks and verify webhook signatures before updating app state.",
            },
          ].map((step) => (
            <div key={step.num} className="docs-step">
              <div className="docs-step-num">{step.num}</div>
              <div className="docs-step-body">
                <div className="docs-step-title">{step.title}</div>
                <p className="docs-step-desc">{step.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <h2
          id="install"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          1. Install packages
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">bash</span>
          </div>
          <pre>
            <code>{`npm install @arcenpay/react
npm install @arcenpay/node`}</code>
          </pre>
        </div>

        <h2
          id="token-route"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          2. Create a backend access-token route
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Keep your API key on the server. When the browser needs ArcenPay
          context, call the Node SDK to identify the current company or user
          and mint a short-lived access token.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">ts</span>
          </div>
          <pre>
            <code>{`import { ArcenClient } from '@arcenpay/node';
import { NextResponse } from 'next/server';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

export async function POST() {
  const session = await client.identify({
    company: { id: 'company_123', name: 'Acme' },
    user: { id: 'user_123', email: 'owner@acme.com' },
    expiresIn: 3600,
  });

  return NextResponse.json({ token: session.token });
}`}</code>
          </pre>
        </div>

        <h2
          id="provider"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          3. Wrap your app with the provider
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`'use client';
import { ArcenPayProvider } from '@arcenpay/react';

export function Providers({
  children,
  accessToken,
}: {
  children: React.ReactNode;
  accessToken: string;
}) {
  return (
    <ArcenPayProvider token={accessToken}>
      {children}
    </ArcenPayProvider>
  );
}`}</code>
          </pre>
        </div>

        <h2
          id="portal"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          4. Render the billing portal
        </h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          If you created a component in the dashboard builder, ArcenEmbed is
          the fastest way to give customers a self-serve billing center.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`import { ArcenEmbed } from '@arcenpay/react';

export function BillingPortal({ token }: { token: string }) {
  return (
    <ArcenEmbed
      accessToken={token}
      componentId="cmp_123"
      initialView="portal"
    />
  );
}`}</code>
          </pre>
        </div>

        <DocImagePlaceholder
          title="Embedded Billing Portal"
          description="Add a screenshot here of your published ArcenEmbed component in a real app layout so developers can see the final customer experience."
          heightClassName="h-80"
        />

        <h2
          id="checkout"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          5. Launch recurring checkout
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`import { CheckoutModal } from '@arcenpay/react';

<CheckoutModal
  planId={1n}
  isOpen={showCheckout}
  onClose={() => setShowCheckout(false)}
  activationEndpoint="/api/request-subscription"
/>`}</code>
          </pre>
        </div>

        <h2
          id="backend"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          6. Keep billing logic on the server
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">ts</span>
          </div>
          <pre>
            <code>{`const entitlement = await client.checkEntitlement(
  'analytics_export',
  { id: 'company_123' },
);

if (!entitlement.enabled) {
  throw new Error('Upgrade required');
}`}</code>
          </pre>
        </div>

        <h2
          id="env"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          Recommended environment variables
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">env</span>
          </div>
          <pre>
            <code>{`NEXT_PUBLIC_ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=cmp_xxxxxxxxx
NEXT_PUBLIC_CHAIN_ID=84532
ARCENPAY_API_KEY=api_live_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx
ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz`}</code>
          </pre>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">
          On this page
        </div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active">
            <a
              href="#build-flow"
              className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground"
            >
              Build flow
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#install"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Install
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#token-route"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Access token
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#provider"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Provider
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#portal"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Billing portal
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#checkout"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Checkout
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#backend"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Backend
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#env"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              Environment
            </a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
