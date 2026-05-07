import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function FeatureGatingGuide() {
  return (
    <DocsPage
      eyebrow="Guides"
      title="Feature gating"
      summary="Build entitlement-aware product experiences by keeping the commercial model in ArcenPay and consuming the resolved access state through the SDKs."
      toc={[
        { href: "#model", label: "Model" },
        { href: "#server", label: "Server gating" },
        { href: "#react", label: "Client gating" },
        { href: "#notes", label: "Operational notes" },
      ]}
    >
      <DocsSection id="model" title="Recommended model">
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Resolve the customer identity once.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Check entitlements on the server before returning protected data.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use React hooks to reflect the same state in the UI.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Keep the plan-to-feature mapping in ArcenPay, not in scattered frontend conditionals.</li>
        </ol>
      </DocsSection>

      <DocsSection id="server" title="Server-side gating">
        <DocsCodeBlock
          lang="ts"
          code={`const result = await client.checkEntitlement("priority_support", {
  id: "company_123",
});

if (!result.enabled) throw new Error("Upgrade required");`}
        />
      </DocsSection>

      <DocsSection id="react" title="Client-side checks">
        <DocsCodeBlock
          lang="tsx"
          code={`import { useFlag } from "@arcenpay/react";

function ExportButton() {
  const enabled = useFlag("analytics_export");

  if (!enabled) return <UpgradePrompt />;
  return <button>Export CSV</button>;
}`}
        />
      </DocsSection>

      <DocsSection id="notes" title="Operational notes">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use add-on grants or flags for controlled unlocks instead of duplicating access state in your own database.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Keep sensitive gating decisions on the server even if the UI also hides locked controls.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use webhooks to react to plan changes, cancellations, invoice issuance, and payments.</li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
