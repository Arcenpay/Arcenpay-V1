import {
  DocsCard,
  DocsCardGrid,
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "./_components/DocsPrimitives";

export default function OverviewPage() {
  return (
    <DocsPage
      eyebrow="Introduction"
      title="Build billing, entitlements, payment links, and optional agent payments with ArcenPay."
      summary="These docs track the supported platform surface in this repo: dashboard-managed catalog setup, ArcenEmbed customer billing experiences, hosted pay links, React entitlement hooks, server-side company and billing APIs, and the optional x402-style agent SDK."
      toc={[
        { href: "#build-flow", label: "Build flow" },
        { href: "#platform-surface", label: "Platform surface" },
        { href: "#dashboard-areas", label: "Dashboard areas" },
        { href: "#install", label: "Install" },
      ]}
    >
      <div className="docs-callout-info mb-5">
        <span className="docs-callout-icon">i</span>
        <div>
          <strong>Default runtime:</strong> the public billing experience in this
          codebase is standardized on <strong>Base Sepolia (84532)</strong>,
          while the lower-level SDKs still expose contract helpers for Sepolia
          and Base mainnet environments.
        </div>
      </div>

      <DocsSection id="build-flow" title="Build flow">
        <DocsCardGrid>
          <DocsCard
            label="Step 1"
            title="Configure the workspace"
            description="Set up plans, add-ons, credits, payment links, billing components, API keys, and webhook endpoints in the dashboard."
            href="/quickstart"
          />
          <DocsCard
            label="Step 2"
            title="Wire the React runtime"
            description="Wrap your app with ArcenPayProvider, identify the customer, and render ArcenEmbed or hosted payment-link entry points."
            href="/sdk-reference/react"
          />
          <DocsCard
            label="Step 3"
            title="Keep secure logic on the server"
            description="Use the Node SDK for access tokens, company APIs, subscription activation, access checks, and webhook verification."
            href="/sdk-reference/node"
          />
          <DocsCard
            label="Step 4"
            title="Sync your app state"
            description="Use signed webhooks for company creation, plan changes, invoice events, and renewal outcomes."
            href="/webhooks"
          />
        </DocsCardGrid>
      </DocsSection>

      <DocsSection id="platform-surface" title="Platform surface">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Recurring subscription flows managed inside published ArcenEmbed
            billing components.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Hosted payment links for one-time charges, invoice pay-now flows,
            and standalone add-ons.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Company, user, feature, flag, and entitlement APIs for server-side
            product gating.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Invoice issuance, payment tracking, and signed outbound webhook
            delivery.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Optional x402-style autonomous payment tooling through the agent SDK
            and advanced Node services.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="dashboard-areas" title="Dashboard areas">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <strong>Catalog:</strong> plans, add-ons, credits, and publishable
            billing configuration.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <strong>Manage:</strong> companies, users, features, and feature
            flags tied to the customer lifecycle.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <strong>Connections:</strong> events, embedded components, and
            webhook endpoints for downstream systems.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <strong>Admin:</strong> invoices, payments, billing plan, audit log,
            settings, and optional agent configuration.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="install" title="Install the main SDKs">
        <DocsCodeBlock
          lang="bash"
          code={`npm install @arcenpay/react
npm install @arcenpay/node

# optional
npm install @arcenpay/agent`}
        />
      </DocsSection>
    </DocsPage>
  );
}
