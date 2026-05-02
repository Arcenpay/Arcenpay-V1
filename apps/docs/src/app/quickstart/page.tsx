export default function QuickstartPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Getting Started</div>
        <div className="docs-page-title-row">
          <h1>Base Sepolia Quickstart</h1>
        </div>

        <p className="docs-lead" id="quickstart">
          This path gets you from zero to a real ArcenPay setup with
          subscription checkout, hosted one-time payments, and entitlement
          checks on Base Sepolia.
        </p>

        <div className="docs-callout info">
          <span className="docs-callout-icon">ℹ</span>
          <div>
            <strong>Before you start:</strong> publish at least one plan in the
            dashboard, run the facilitator on `CHAIN_ID=84532`, and configure a
            real `NEXT_PUBLIC_GRAPH_URL_84532`.
          </div>
        </div>

        <h2 id="build-flow">Build flow</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Install and configure the runtime</div>
              <p className="docs-step-desc">
                Point your app, facilitator, and subgraph settings at Base
                Sepolia only.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Publish plans and add-ons</div>
              <p className="docs-step-desc">
                Use recurring plans for subscriptions and one-time add-ons for
                hosted payment links.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Wire checkout</div>
              <p className="docs-step-desc">
                Use `CheckoutModal` for plans and `/pay/:slug` hosted checkout
                for one-time USDC payments.
              </p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">4</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Gate access with entitlements</div>
              <p className="docs-step-desc">
                Verify access from the dashboard APIs or SDK helpers instead of
                relying on frontend-only state.
              </p>
            </div>
          </div>
        </div>

        <h2 id="env">1. Runtime env</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">env</span>
          </div>
          <pre>
            <code>{`NEXT_PUBLIC_CHAIN_ID=84532
MEAP_DEFAULT_CHAIN_ID=84532
NEXT_PUBLIC_GRAPH_URL_84532=https://your-subgraph
FACILITATOR_BASE_URL_84532=http://localhost:3402
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org

# Facilitator
CHAIN_ID=84532
RPC_URL=https://sepolia.base.org`}</code>
          </pre>
        </div>

        <h2 id="provider">2. Wrap your app</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`'use client';
import { ArcenPayProvider } from '@arcenpay/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ArcenPayProvider chainId={84532}>
      {children}
    </ArcenPayProvider>
  );
}`}</code>
          </pre>
        </div>

        <h2 id="subscriptions">3. Launch subscription checkout</h2>
        <p>
          Recurring plans still use the subscription flow. Render a pricing
          table or open `CheckoutModal` directly, then let your backend call
          `/api/v1/subscriptions/activate`.
        </p>

        <h2 id="hosted-payments">4. Launch hosted one-time payments</h2>
        <p>
          For setup fees, one-time add-ons, or invoice pay-now flows, create a
          payment link from the dashboard Payments section or the add-on detail
          view. Customers complete the transfer through `/pay/:slug`.
        </p>

        <h2 id="entitlements">5. Gate access</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`import { useEntitlementCheck } from '@arcenpay/react';

function PremiumExport() {
  const { result, loading } = useEntitlementCheck('analytics_export');
  if (loading) return null;
  if (!result?.enabled) return <UpgradePrompt />;
  return <button>Export data</button>;
}`}</code>
          </pre>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#build-flow">Build flow</a></li>
          <li className="docs-toc-item"><a href="#env">Runtime env</a></li>
          <li className="docs-toc-item"><a href="#subscriptions">Subscription checkout</a></li>
          <li className="docs-toc-item"><a href="#hosted-payments">Hosted payments</a></li>
          <li className="docs-toc-item"><a href="#entitlements">Entitlements</a></li>
        </ul>
      </nav>
    </div>
  );
}
