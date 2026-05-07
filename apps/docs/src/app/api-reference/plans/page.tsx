import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ApiPlansPage() {
  return (
    <DocsPage
      eyebrow="API Reference"
      title="Catalog and checkout APIs"
      summary="Plans themselves are managed from the dashboard in this codebase. The public HTTP surface you usually integrate against is centered on components, payment links, checkout sessions, features, and flags."
      toc={[
        { href: "#components", label: "Components" },
        { href: "#payment-links", label: "Payment links" },
        { href: "#checkout-sessions", label: "Checkout sessions" },
        { href: "#features", label: "Features and flags" },
      ]}
    >
      <DocsSection id="components" title="Components API">
        <DocsCodeBlock
          lang="bash"
          code={`GET  /api/v1/components
POST /api/v1/components`}
        />
      </DocsSection>

      <DocsSection id="payment-links" title="Payment links API">
        <DocsCodeBlock
          lang="bash"
          code={`GET  /api/v1/payment-links
POST /api/v1/payment-links
GET  /api/v1/payment-links/:id`}
        />
        <DocsCodeBlock
          lang="json"
          code={`{
  "kind": "CUSTOM",
  "name": "Priority setup fee",
  "amount": 49,
  "acceptedToken": "0xUSDC",
  "recipientWallet": "0xabc..."
}`}
        />
      </DocsSection>

      <DocsSection id="checkout-sessions" title="Checkout sessions API">
        <DocsCodeBlock
          lang="bash"
          code={`GET  /api/v1/checkout-sessions/:id
POST /api/v1/checkout-sessions`}
        />
      </DocsSection>

      <DocsSection id="features" title="Features and flags">
        <DocsCodeBlock
          lang="bash"
          code={`GET    /api/v1/features
GET    /api/v1/features/:id
GET    /api/v1/feature-flags
POST   /api/v1/feature-flags`}
        />
      </DocsSection>
    </DocsPage>
  );
}
