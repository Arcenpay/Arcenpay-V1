import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function FeatureFlagsPage() {
  return (
    <DocsPage
      eyebrow="Core Concepts"
      title="Feature flags and entitlements"
      summary="ArcenPay resolves access from the commercial state you manage in the dashboard: active plans, add-ons, overrides, and usage-aware entitlement rules. Your app should consume the resolved answer rather than hardcoding plan logic in the UI."
      toc={[
        { href: "#resolution", label: "Resolution model" },
        { href: "#react", label: "React hooks" },
        { href: "#server", label: "Server checks" },
      ]}
    >
      <DocsSection id="resolution" title="How access is resolved">
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Company-specific overrides are checked first.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Active subscription plan entitlements are applied next.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Purchased add-ons and one-time grants are merged in.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Optional usage rules or traits can further refine the final result.</li>
        </ol>
      </DocsSection>

      <DocsSection id="react" title="Read access in React">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useEntitlement, useFlag } from "@arcenpay/react";

const enabled = useFlag("analytics_export");
const entitlement = useEntitlement(walletAddress, "analytics_export");`}
        />
      </DocsSection>

      <DocsSection id="server" title="Verify sensitive access on the server">
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
    </DocsPage>
  );
}
