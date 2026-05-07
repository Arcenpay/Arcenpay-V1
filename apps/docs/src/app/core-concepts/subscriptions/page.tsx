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
      summary="A subscription is the recurring billing relationship created after an ArcenPay checkout flow succeeds. In the current platform, subscriptions can be bought, upgraded immediately, downgraded for the next renewal boundary, or cancelled either at period end or immediately on-chain."
      toc={[
        { href: "#lifecycle", label: "Lifecycle" },
        { href: "#operations", label: "Operations" },
        { href: "#react", label: "React checks" },
        { href: "#server", label: "Server checks" },
        { href: "#cancel", label: "Cancellation" },
      ]}
    >
      <DocsSection id="lifecycle" title="Lifecycle">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Active:</strong> the customer has a valid subscription and should receive the attached entitlements.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Pending plan change:</strong> the current paid access is still live, but a future downgrade or renewal-boundary change has already been scheduled.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Needs attention:</strong> renewal or billing has failed and requires follow-up.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Cancelled:</strong> future billing stops and downstream access should be updated from the latest entitlement or webhook state.</li>
        </ul>
      </DocsSection>

      <DocsSection id="operations" title="Supported subscription operations">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Current behavior</th>
              <th>Common result mode</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Buy a new subscription</td>
              <td>Start from published checkout and finish with authoritative activation.</td>
              <td><code>activateSubscription()</code> success</td>
            </tr>
            <tr>
              <td>Upgrade to a higher paid plan</td>
              <td>Immediate prorated upgrade after on-chain config verification and, when needed, a prorated payment.</td>
              <td><code>immediate_prorated_upgrade</code></td>
            </tr>
            <tr>
              <td>Preview an upgrade before signing</td>
              <td>Calculate the exact proration amount before any final plan-change tx is consumed.</td>
              <td><code>immediate_prorated_upgrade_preview</code></td>
            </tr>
            <tr>
              <td>Downgrade to a lower paid plan</td>
              <td>Usually stays on the current plan until the next renewal boundary.</td>
              <td><code>next_renewal_on_chain</code></td>
            </tr>
            <tr>
              <td>Cancel but keep access through the current term</td>
              <td>Schedules cancellation at period end and keeps the current paid access active.</td>
              <td><code>cancel_at_period_end</code></td>
            </tr>
            <tr>
              <td>Cancel immediately</td>
              <td>Requires explicit immediate cancellation and a verified on-chain cancellation transaction.</td>
              <td><code>cancelled_on_chain</code></td>
            </tr>
          </tbody>
        </table>
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
          Use the latest entitlement result, subscription ledger state, and
          webhook events like <code>company.plan.changed</code>,
          <code>company.plan.cancelled</code>, <code>subscription.renewed</code>,
          and <code>subscription.renewal_failed</code> instead of assuming the
          last client-side screen is authoritative.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
