import Link from "next/link";
import DocImagePlaceholder from "./_components/DocImagePlaceholder";

export default function OverviewPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">
          Introduction
        </div>

        <section className="border border-border bg-gradient-to-b from-card to-muted/30 rounded-2xl p-7 mb-7 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground mb-2.5">
            Public documentation
          </div>
          <h1 className="text-[clamp(34px,5vw,52px)] leading-[1.02] tracking-[-0.05em] font-bold mb-3.5">
            Build checkout, embedded billing surfaces, entitlements, and agent
            payments with ArcenPay.
          </h1>
          <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-0 max-w-[740px]">
            These docs cover the supported ArcenPay platform surface:
            dashboard-managed plans and billing surfaces, embedded customer
            portal experiences, recurring checkout, short-lived access tokens,
            and backend verification through the React and Node SDKs.
          </p>

          <div className="flex items-center gap-2.5 flex-wrap mt-[18px]">
            <Link
              href="/quickstart"
              className="inline-flex items-center gap-1.5 rounded-xl bg-foreground text-background hover:bg-foreground/85 text-[13px] font-bold px-3.5 py-2.5 transition-colors"
            >
              Get started
            </Link>
            <Link
              href="/sdk-reference"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card hover:text-foreground hover:border-foreground/20 text-[13px] font-bold px-3.5 py-2.5 text-muted-foreground transition-all"
            >
              Explore SDKs
            </Link>
          </div>
        </section>

        <DocImagePlaceholder
          title="Homepage or Dashboard Product Tour"
          description="Add a product screenshot here that shows the dashboard, published plans, or the embedded billing portal so new developers immediately understand what ArcenPay looks like in practice."
          heightClassName="h-72"
        />

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            <strong>Supported runtime:</strong> ArcenPay public integrations are
            currently standardized on <strong>Base Sepolia (84532)</strong>.
          </div>
        </div>

        <h2
          id="docs-flow"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          Build flow
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
          {[
            {
              step: "Step 1",
              title: "Set up billing in the dashboard",
              desc: "Connect the wallet that receives funds, create plans, configure customer portal components, and publish your billing setup.",
              href: "/quickstart",
              link: "Quickstart →",
            },
            {
              step: "Step 2",
              title: "Render billing in your app",
              desc: "Use the React SDK for checkout, embedded portal surfaces, billing history, and entitlement-aware UI.",
              href: "/features/embedded-components",
              link: "Embedded components →",
            },
            {
              step: "Step 3",
              title: "Handle secure actions on the server",
              desc: "Use the Node SDK to issue short-lived access tokens, activate subscriptions, check entitlements, and verify webhooks.",
              href: "/sdk-reference/node",
              link: "Node SDK →",
            },
            {
              step: "Step 4",
              title: "Keep your product in sync",
              desc: "Use webhooks to react to subscription changes, invoice activity, and payment events without polling.",
              href: "/webhooks",
              link: "Webhooks →",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="border border-border bg-card rounded-2xl p-[18px] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg hover:shadow-black/5"
            >
              <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-1.5">
                {card.step}
              </div>
              <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-1.5">
                {card.title}
              </h3>
              <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                {card.desc}
              </p>
              <Link
                href={card.href}
                className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-bold text-foreground hover:underline"
              >
                {card.link}
              </Link>
            </div>
          ))}
        </div>

        <h2
          id="what-you-can-build"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          What you can build
        </h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Recurring subscription checkout for paid plans.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Dashboard-managed customer billing portals with plan management,
            invoices, payment methods, and usage blocks.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Hosted or embedded billing entry points for upgrades, onboarding,
            and account management.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Server-side access-token minting, entitlement checks, and secure
            billing actions using the Node SDK.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Feature flags, usage tracking, and metered entitlements tied to a
            company or user context.
          </li>
        </ul>

        <h2
          id="install"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          Install the Main SDKs
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
          id="minimum-env"
          className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5"
        >
          Common environment variables
        </h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">env</span>
          </div>
          <pre>
            <code>{`NEXT_PUBLIC_ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz
ARCENPAY_API_KEY=api_live_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=cmp_xxxxxxxxx
NEXT_PUBLIC_CHAIN_ID=84532`}</code>
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
              href="#docs-flow"
              className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground"
            >
              Build flow
            </a>
          </li>
          <li className="toc-item">
            <a
              href="#what-you-can-build"
              className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors"
            >
              What you can build
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
              href="#minimum-env"
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
