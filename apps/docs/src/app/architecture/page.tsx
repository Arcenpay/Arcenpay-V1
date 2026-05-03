export default function ArchitecturePage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Platform</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Architecture</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="architecture">
          ArcenPay combines dashboard-managed billing operations, public SDKs,
          API endpoints, and chain-backed settlement. Most teams integrate only
          the dashboard, public APIs, and SDK layers.
        </p>

        <h2 id="dashboard">Dashboard layer</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The dashboard is the control plane for plans, invoices, payment links,
          feature flags, embedded components, customer records, and operational
          settings. It is where most product teams configure billing behavior.
        </p>

        <h2 id="sdk-api">SDK and API layer</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><code>@arcenpay/react</code> powers checkout, portal embeds, templates, and entitlement-aware UI.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><code>@arcenpay/node</code> handles identify, secure billing actions, and webhook verification.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><code>@arcenpay/agent</code> enables autonomous x402 paid requests with session funding and top-ups.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Public REST endpoints cover auth, plans, subscriptions, sessions, flags, and rendered component data.</li>
        </ul>

        <h2 id="chain">Chain-backed settlement</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Under the hood, ArcenPay uses contract infrastructure for subscription
          state, fee collection, session funding, and usage verification. Public
          apps usually should not call those contracts directly unless they own
          the low-level orchestration.
        </p>

        <h2 id="integration-boundary">Recommended integration boundary</h2>
        <div className="docs-callout-tip mb-5">
          <span className="docs-callout-icon">✓</span>
          <div>
            Treat the dashboard plus documented SDKs and APIs as the supported
            platform surface. That gives you stable billing features without
            coupling your app to private storage or internal settlement flows.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#architecture">Architecture</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#dashboard">Dashboard layer</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#sdk-api">SDK and API layer</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#chain">Chain-backed settlement</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#integration-boundary">Integration boundary</a></li>
        </ul>
      </nav>
    </div>
  );
}
