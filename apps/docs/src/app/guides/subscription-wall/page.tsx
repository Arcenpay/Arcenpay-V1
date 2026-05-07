import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function SubscriptionWallGuide() {
  return (
    <DocsPage
      eyebrow="Guides"
      title="SaaS subscription wall"
      summary="A strong subscription wall uses server-side entitlement checks for protected data and lightweight React-side checks for a smoother product experience."
      toc={[
        { href: "#tiers", label: "Define tiers" },
        { href: "#ui", label: "Gate the UI" },
        { href: "#api", label: "Gate the API" },
        { href: "#sync", label: "Sync billing state" },
      ]}
    >
      <DocsSection id="tiers" title="1. Define your tiers in the dashboard">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Create the plans, add-ons, and flags that map to your product access
          model before writing any conditional logic in the app.
        </p>
      </DocsSection>

      <DocsSection id="ui" title="2. Reflect access in the UI">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useFlag } from "@arcenpay/react";

export function ProtectedPanel() {
  const enabled = useFlag("analytics_export");

  if (!enabled) return <UpgradePrompt />;
  return <PremiumDashboard />;
}`}
        />
      </DocsSection>

      <DocsSection id="api" title="3. Enforce access on the server">
        <DocsCodeBlock
          lang="ts"
          code={`const entitlement = await client.checkEntitlement("analytics_export", {
  id: "company_123",
});

if (!entitlement.enabled) {
  throw new Error("Upgrade required");
}`}
        />
      </DocsSection>

      <DocsSection id="sync" title="4. Sync billing state with webhooks">
        <DocsCodeBlock
          lang="ts"
          code={`if (event.event === "company.plan.changed") {
  await db.accounts.update({
    where: { arcenCompanyId: event.data.companyId },
    data: { billingStatus: "active" },
  });
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
