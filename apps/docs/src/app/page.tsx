export default function OverviewPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Introduction</div>

        <section className="docs-intro-hero" id="introduction">
          <div className="docs-intro-eyebrow">Documentation</div>
          <h1 className="docs-intro-title">
            Sell subscriptions, one-time payments, and gated access from one platform.
          </h1>
          <p className="docs-lead" style={{ marginBottom: 0 }}>
            ArcenPay gives you two production-facing billing surfaces today:
            recurring subscription checkout for plans, and hosted one-time USDC
            checkout for add-ons, invoice pay-now links, and custom charges.
          </p>

          <div className="docs-intro-actions">
            <a href="/quickstart" className="docs-btn-primary">
              Get started
            </a>
            <a href="/features/checkout" className="docs-btn-secondary">
              See checkout patterns
            </a>
          </div>
        </section>

        <div className="docs-callout info">
          <span className="docs-callout-icon">ℹ</span>
          <div>
            <strong>Current runtime:</strong> the product is standardized on
            <strong> Base Sepolia (84532)</strong> for this release hardening
            pass. Ethereum Sepolia remains legacy/internal reference only.
          </div>
        </div>

        <div className="docs-lifecycle" style={{ marginBottom: 28 }}>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">Live surface</div>
            <div className="docs-lifecycle-name">Recurring subscriptions</div>
            <div className="docs-lifecycle-desc">
              Recurring plans still use the subscription checkout flow plus
              activation and entitlement checks.
            </div>
          </div>
          <div className="docs-lifecycle-item">
            <div className="docs-lifecycle-badge active">Live surface</div>
            <div className="docs-lifecycle-name">Hosted one-time payments</div>
            <div className="docs-lifecycle-desc">
              Payment links and checkout sessions cover standalone add-ons,
              invoice pay-now, and custom USDC charges.
            </div>
          </div>
        </div>

        <h2 id="docs-flow">Build flow</h2>
        <div className="docs-card-grid">
          <div className="docs-card">
            <div className="docs-card-kicker">Step 1</div>
            <h3 className="docs-card-title">Model plans and add-ons</h3>
            <p className="docs-card-text">
              Define recurring plans, then create one-time or upsell add-ons in
              Catalog.
            </p>
            <a className="docs-card-link" href="/core-concepts/plans">
              Plans and add-ons →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 2</div>
            <h3 className="docs-card-title">Launch checkout</h3>
            <p className="docs-card-text">
              Use `CheckoutModal` for subscriptions and hosted pay links for
              one-time USDC payments.
            </p>
            <a className="docs-card-link" href="/features/checkout">
              Checkout patterns →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 3</div>
            <h3 className="docs-card-title">Gate product access</h3>
            <p className="docs-card-text">
              Evaluate real plan and add-on entitlements through the dashboard
              APIs and SDK helpers.
            </p>
            <a className="docs-card-link" href="/core-concepts/feature-flags">
              Entitlements and flags →
            </a>
          </div>

          <div className="docs-card">
            <div className="docs-card-kicker">Step 4</div>
            <h3 className="docs-card-title">Operate and reconcile</h3>
            <p className="docs-card-text">
              Track invoices, payment links, checkout sessions, proofs, and
              webhooks from the dashboard.
            </p>
            <a className="docs-card-link" href="/webhooks">
              Operations →
            </a>
          </div>
        </div>

        <h2 id="what-is-live">What is live right now</h2>
        <ul>
          <li>Recurring subscription checkout on Base Sepolia.</li>
          <li>Hosted one-time USDC links for custom charges, invoice payments, and standalone add-ons.</li>
          <li>Dashboard-managed feature rules with plan, add-on, usage, trait, and zkTLS targeting.</li>
          <li>Invoice generation, signed downloads, resend delivery, and payment ledger tracking.</li>
        </ul>

        <h2 id="install">Install the SDKs</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">bash</span>
          </div>
          <pre>
            <code>{`npm install @arcenpay/react @arcenpay/sdk viem wagmi
npm install @arcenpay/node`}</code>
          </pre>
        </div>

        <h2 id="minimum-env">Minimum runtime env</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">env</span>
          </div>
          <pre>
            <code>{`NEXT_PUBLIC_CHAIN_ID=84532
MEAP_DEFAULT_CHAIN_ID=84532
NEXT_PUBLIC_GRAPH_URL_84532=https://your-subgraph
FACILITATOR_BASE_URL_84532=http://localhost:3402
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org`}</code>
          </pre>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#docs-flow">Build flow</a></li>
          <li className="docs-toc-item"><a href="#what-is-live">What is live</a></li>
          <li className="docs-toc-item"><a href="#install">Install</a></li>
          <li className="docs-toc-item"><a href="#minimum-env">Minimum env</a></li>
        </ul>
      </nav>
    </div>
  );
}
