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
      summary="The current public billing API surface focuses on access checks, usage consumption, subscription activation, company plan changes, and unsubscribe flows rather than a generic list-all-subscriptions REST resource."
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
      </DocsSection>
    </DocsPage>
  );
}
