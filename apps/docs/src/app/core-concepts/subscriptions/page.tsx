import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function SubscriptionsPage() {
  return (
    <DocsPage
      eyebrow="Core Concepts"
      title="Subscriptions"
      summary="A subscription is the active recurring billing relationship created after an ArcenPay checkout flow succeeds. The safest source of truth for product access is the resolved entitlement result rather than a local UI assumption."
      toc={[
        { href: "#lifecycle", label: "Lifecycle" },
        { href: "#react", label: "React checks" },
        { href: "#server", label: "Server checks" },
        { href: "#cancel", label: "Cancellation" },
      ]}
    >
      <DocsSection id="lifecycle" title="Lifecycle">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Active:</strong> the customer has a valid subscription and should receive the attached entitlements.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Needs attention:</strong> renewal or billing has failed and requires follow-up.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Cancelled:</strong> future billing stops and downstream access should be updated from the latest entitlement or webhook state.</li>
        </ul>
      </DocsSection>

      <DocsSection id="react" title="Check access in React">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useFlag } from "@arcenpay/react";

const enabled = useFlag("analytics_export");
if (!enabled) return <UpgradePrompt />;`}
        />
      </DocsSection>

      <DocsSection id="server" title="Check access on the server">
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

      <DocsSection id="cancel" title="Handle cancellation and renewal outcomes">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-0">
          Update your app state from the latest entitlement response or webhook
          event rather than assuming the last client-side screen is authoritative.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
