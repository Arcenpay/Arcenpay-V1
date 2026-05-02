export default function SupportPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Resources</div>
        <div className="docs-page-title-row"><h1>Support</h1></div>

        <p className="docs-lead">
          Use this page as the operational handoff for teams deploying the
          current product surface: Base Sepolia subscriptions, hosted one-time
          payments, and dashboard-managed access control.
        </p>

        <h2 id="runtime">Current runtime support</h2>
        <ul>
          <li>Primary chain: Base Sepolia (84532).</li>
          <li>Recurring plans: supported through subscription checkout.</li>
          <li>One-time payments: supported through hosted Base Sepolia USDC links.</li>
          <li>Sepolia: legacy/internal reference only for now.</li>
        </ul>

        <div className="docs-callout info">
          <span className="docs-callout-icon">i</span>
          <div>
            If a dashboard surface and the facilitator disagree on chain or
            runtime health, trust the warning state and fix the environment
            before treating empty metrics as real business data.
          </div>
        </div>

        <h2 id="channels">Support channels</h2>
        <div className="docs-card-grid">
          <div className="docs-card">
            <div className="docs-card-kicker">Operations</div>
            <h3 className="docs-card-title">Deployment support</h3>
            <p className="docs-card-text">
              Use this for dashboard setup, payment-link issues, invoice
              delivery, and facilitator/runtime configuration.
            </p>
            <a href="mailto:support@arcenpay.com" className="docs-card-link">
              Contact support →
            </a>
          </div>
          <div className="docs-card">
            <div className="docs-card-kicker">Implementation</div>
            <h3 className="docs-card-title">Launch checklist</h3>
            <p className="docs-card-text">
              Validate Base Sepolia chain alignment, facilitator health,
              payment recipient wallet, and webhook delivery before go-live.
            </p>
            <a href="/quickstart" className="docs-card-link">
              Review setup flow →
            </a>
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#runtime">Runtime support</a></li>
          <li className="docs-toc-item"><a href="#channels">Support channels</a></li>
        </ul>
      </nav>
    </div>
  );
}
