import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ApiSubscriptionsPage() {
  return (
    <DocsPage
      eyebrow="API Reference"
      title="Billing and subscription APIs"
      summary="The current public billing API surface focuses on access checks, usage consumption, new subscription activation, plan changes, and unsubscribe flows rather than a generic list-all-subscriptions REST resource."
      toc={[
        { href: "#checks", label: "Checks" },
        { href: "#usage", label: "Usage consume" },
        { href: "#activation", label: "Activation" },
        { href: "#plan-actions", label: "Plan actions" },
      ]}
    >
      <DocsSection id="checks" title="Access checks">
        <DocsCodeBlock
          lang="bash"
          code={`GET /api/v1/check?key=scan`}
        />
        <DocsCodeBlock
          lang="ts"
          code={`const result = await client.checkEntitlement("scan", {
  id: "company_123",
});`}
        />
      </DocsSection>

      <DocsSection id="usage" title="Consume metered usage">
        <DocsCodeBlock
          lang="bash"
          code={`POST /api/v1/usage/consume`}
        />
        <DocsCodeBlock
          lang="json"
          code={`{
  "featureKey": "scan",
  "idempotencyKey": "scan-req-1"
}`}
        />
      </DocsSection>

      <DocsSection id="activation" title="Activate an on-chain subscription">
        <DocsCodeBlock
          lang="bash"
          code={`POST /api/v1/subscriptions/activate`}
        />
        <DocsCodeBlock
          lang="json"
          code={`{
  "planId": "starter",
  "paymentAccount": "0xabc...",
  "company": {
    "id": "company_123",
    "wallet": "0xabc..."
  }
}`}
        />
      </DocsSection>

      <DocsSection id="plan-actions" title="Company plan actions">
        <DocsCodeBlock
          lang="bash"
          code={`POST /api/v1/companies/plan
POST /api/v1/companies/unsubscribe`}
        />

        <p className="text-[15px] text-muted-foreground leading-relaxed mt-[15px] mb-[15px]">
          These endpoints cover the rest of the subscription lifecycle after the
          initial purchase.
        </p>

        <table className="docs-table">
          <thead>
            <tr>
              <th>Operation</th>
              <th>Endpoint</th>
              <th>Typical mode</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Upgrade preview</td>
              <td><code>POST /api/v1/companies/plan</code> with <code>previewOnly: true</code></td>
              <td><code>immediate_prorated_upgrade_preview</code></td>
            </tr>
            <tr>
              <td>Immediate paid upgrade</td>
              <td><code>POST /api/v1/companies/plan</code> with verified plan-change tx hashes</td>
              <td><code>immediate_prorated_upgrade</code></td>
            </tr>
            <tr>
              <td>Scheduled downgrade</td>
              <td><code>POST /api/v1/companies/plan</code></td>
              <td><code>next_renewal_on_chain</code></td>
            </tr>
            <tr>
              <td>Cancel at period end</td>
              <td><code>POST /api/v1/companies/unsubscribe</code></td>
              <td><code>cancel_at_period_end</code></td>
            </tr>
            <tr>
              <td>Immediate cancellation</td>
              <td><code>POST /api/v1/companies/unsubscribe</code> with <code>immediate: true</code></td>
              <td><code>cancelled_on_chain</code></td>
            </tr>
          </tbody>
        </table>

        <DocsCodeBlock
          lang="json"
          code={`{
  "planId": "plan_pro",
  "previewOnly": true
}`}
        />

        <DocsCodeBlock
          lang="json"
          code={`{
  "planId": "plan_pro",
  "autopayConfigTxHash": "0x...",
  "paymentTxHash": "0x...",
  "accessChangeTxHash": "0x..."
}`}
        />

        <DocsCodeBlock
          lang="json"
          code={`{
  "autopayControlTxHash": "0x..."
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
