export default function FeatureFlagsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Core Concepts</div>
        <div className="flex items-center justify-between gap-4 mb-3.5">
          <h1>Feature Flags and Entitlements</h1>
        </div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="feature-flags">
          ArcenPay resolves access from the commercial state you manage in the
          dashboard: active plans, one-time add-on grants, company-level overrides,
          and the entitlement rules attached to your product.
        </p>

        <h2 id="how-it-works">How access is resolved</h2>
        <ol>
          <li>Company-specific overrides are checked first.</li>
          <li>Active subscription plan entitlements are applied.</li>
          <li>Purchased add-ons and one-time grants are merged in.</li>
          <li>Optional usage rules or traits can further refine the final result.</li>
        </ol>

        <h2 id="dashboard-model">Dashboard model</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Treat the dashboard as the source of truth for feature definitions and
          plan-to-feature mapping. Your app should consume the result through the
          SDKs or API instead of hardcoding plan logic in the frontend.
        </p>

        <h2 id="react-sdk">React SDK</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header"><span className="docs-codeblock-lang">tsx</span></div>
          <pre>
            <code>{`import { useEntitlementCheck } from '@arcenpay/react';

function ExportButton() {
  const { enabled, loading } = useEntitlementCheck('analytics_export');

  if (loading) return null;
  if (!enabled) return <UpgradePrompt />;

  return <button>Export CSV</button>;
}`}</code>
          </pre>
        </div>

        <h2 id="server-side">Server-side verification</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Sensitive access should still be enforced on the server. Use the
          Node SDK or your API integration to verify entitlements before returning protected data.
        </p>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#how-it-works">How access is resolved</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#dashboard-model">Dashboard model</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react-sdk">React SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#server-side">Server-side verification</a></li>
        </ul>
      </nav>
    </div>
  );
}
