import DocImagePlaceholder from "../_components/DocImagePlaceholder";

export default function ArchitecturePage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">
          Platform
        </div>
        <div className="flex items-center justify-between gap-4 mb-3.5">
          <h1>Architecture</h1>
        </div>

        <p
          className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]"
          id="architecture"
        >
          ArcenPay is designed so most product teams can stay at the platform
          layer. You configure billing in the dashboard, render customer-facing
          experiences with the React SDK, and keep sensitive billing logic on
          your backend with the Node SDK.
        </p>

        <DocImagePlaceholder
          title="Architecture Diagram"
          description="Add a simple diagram here that shows Dashboard → Node SDK → React SDK → Customer App, with chain-backed settlement running underneath as managed infrastructure."
          heightClassName="h-72"
        />

        <h2 id="control-plane">Dashboard control plane</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The dashboard is where you manage the parts of ArcenPay that should be
          configured, not hardcoded: plans, prices, payment links, billing
          components, customer records, invoices, webhooks, and workspace
          settings.
        </p>

        <h2 id="frontend">Frontend layer</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <code>@arcenpay/react</code> renders checkout, ArcenEmbed portal
            surfaces, billing history, and entitlement-aware UI.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The browser receives only short-lived access tokens, never your
            workspace API key.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Component ids and portal layouts come from the dashboard so you can
            update billing surfaces without rebuilding core app logic.
          </li>
        </ul>

        <h2 id="backend">Backend layer</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <code>@arcenpay/node</code> issues access tokens, activates
            subscriptions, checks entitlements, tracks usage, and verifies
            webhook signatures.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Your server decides when to identify a company or user and what app
            permissions should depend on ArcenPay billing state.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            This keeps your business logic, API keys, and billing decisions
            inside trusted infrastructure.
          </li>
        </ul>

        <h2 id="managed-internals">Managed internals</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Under the hood, ArcenPay still coordinates the chain-backed
          subscription and settlement layer. That part is important to the
          platform, but most integrators should not depend on those internals
          directly unless they intentionally want low-level protocol control.
        </p>

        <div className="docs-callout-tip mb-5">
          <span className="docs-callout-icon">✓</span>
          <div>
            The recommended boundary is simple: dashboard for configuration,
            React for UI, Node for secure actions, and webhooks for sync.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">
          On this page
        </div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#architecture">Architecture</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#control-plane">Dashboard</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#frontend">Frontend</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#backend">Backend</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#managed-internals">Managed internals</a></li>
        </ul>
      </nav>
    </div>
  );
}
