export default function FeatureFlagsPage() {
  return (
    <div className="docs-body" style={{ width: "100%" }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Core Concepts</div>
        <div className="docs-page-title-row">
          <h1>Feature Flags and Entitlements</h1>
        </div>

        <p className="docs-lead" id="feature-flags">
          ArcenPay evaluates access from the dashboard’s real flag rules,
          company overrides, plan assignments, add-on grants, usage metrics,
          and optional zkTLS proofs. Feature flags are no longer documented as
          a Tableland-only system.
        </p>

        <h2 id="how-it-works">How access is resolved</h2>
        <ol>
          <li>Company overrides are checked first.</li>
          <li>Flag rules are evaluated by priority order.</li>
          <li>Plan and add-on entitlements are merged from stored catalog metadata.</li>
          <li>Usage counters, traits, and zkTLS claims can refine the final answer.</li>
        </ol>

        <h2 id="dashboard-model">Dashboard model</h2>
        <p>
          The dashboard stores feature definitions in Prisma and evaluates rules
          server-side. Companies can gain access through their active plan or
          through purchased add-ons recorded as add-on grants.
        </p>

        <h2 id="react-sdk">React SDK</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header"><span className="docs-codeblock-lang">tsx</span></div>
          <pre>
            <code>{`import { useEntitlementCheck } from '@arcenpay/react';

function ExportButton() {
  const { result, loading } = useEntitlementCheck('analytics_export');

  if (loading) return null;
  if (!result?.enabled) return <UpgradePrompt />;

  return <button>Export CSV</button>;
}`}</code>
          </pre>
        </div>

        <h2 id="server-side">Server-side verification</h2>
        <p>
          Sensitive access should still be enforced on the server. Use the
          dashboard’s `/api/v1/check` or your Node integration to verify
          entitlements before returning protected data.
        </p>

        <h2 id="where-lit-fits">Where Lit fits</h2>
        <p>
          Lit decryption is available as an optional integration point, but the
          runtime access model in this codebase is centered on dashboard rules
          and facilitator-backed checks. Do not assume an end-to-end encrypted
          content pipeline unless you have implemented it explicitly.
        </p>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#how-it-works">How access is resolved</a></li>
          <li className="docs-toc-item"><a href="#dashboard-model">Dashboard model</a></li>
          <li className="docs-toc-item"><a href="#react-sdk">React SDK</a></li>
          <li className="docs-toc-item"><a href="#server-side">Server-side verification</a></li>
        </ul>
      </nav>
    </div>
  );
}
