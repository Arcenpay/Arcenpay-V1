import {
  DocsPage,
  DocsSection,
} from "../_components/DocsPrimitives";

export default function ArchitecturePage() {
  return (
    <DocsPage
      eyebrow="Platform"
      title="Architecture"
      summary="ArcenPay is structured so most product teams can stay at the platform layer. The dashboard owns catalog and workspace configuration, the React SDK owns customer-facing billing surfaces, the Node SDK owns secure server actions, and the chain-backed runtime operates underneath that boundary."
      toc={[
        { href: "#dashboard", label: "Dashboard" },
        { href: "#react", label: "React runtime" },
        { href: "#backend", label: "Backend" },
        { href: "#runtime", label: "Runtime services" },
      ]}
    >
      <DocsSection id="dashboard" title="Dashboard control plane">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The dashboard is where you configure the parts of ArcenPay that should
          not be hardcoded into your product: plans, add-ons, credits,
          published billing components, payment links, companies, users, flags,
          invoices, payments, webhooks, API keys, and workspace settings.
        </p>
      </DocsSection>

      <DocsSection id="react" title="React runtime">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <code>@arcenpay/react</code> gives you the current customer-facing
            runtime: <code>ArcenPayProvider</code>, <code>ArcenEmbed</code>,
            feature hooks, usage consumption, and payment-link helpers.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The provider manages the session boundary for the browser by using a
            publishable key plus <code>identify()</code>.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Published component ids come from the dashboard so the billing UI
            can evolve without forking core app logic.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="backend" title="Backend SDK and APIs">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <code>@arcenpay/node</code> is the main secure integration layer for
            API-key auth, access-token minting, company APIs, subscription
            activation, entitlement checks, usage consumption, and webhook
            verification.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Your app should treat billing authorization, paid API decisions, and
            identity resolution as server-owned logic.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The optional agent and x402 tooling live beside that standard path
            rather than replacing it.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="runtime" title="Runtime services underneath the public surface">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          This monorepo also contains the facilitator, contracts, subgraph, and
          low-level SDK packages that power renewals, webhook fan-out, event
          reconciliation, and contract-aware helpers. They matter operationally,
          but most product teams should integrate through the dashboard, React
          SDK, Node SDK, and documented webhook/API boundaries.
        </p>

        <div className="docs-callout-tip mb-5">
          <span className="docs-callout-icon">✓</span>
          <div>
            The clean boundary is: dashboard for configuration, React for UI,
            Node for secure actions, and webhooks for sync.
          </div>
        </div>
      </DocsSection>
    </DocsPage>
  );
}
