import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ExpressPage() {
  return (
    <DocsPage
      eyebrow="Frameworks"
      title="Express integration"
      summary="Use @arcenpay/node inside your Express server for company identification, entitlement checks, usage consumption, subscription activation, and webhook verification."
      toc={[
        { href: "#client", label: "Client" },
        { href: "#gating", label: "Route gating" },
        { href: "#usage", label: "Usage actions" },
        { href: "#webhooks", label: "Webhooks" },
      ]}
    >
      <DocsSection id="client" title="Create the client">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenClient } from "@arcenpay/node";

export const arcen = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});`}
        />
      </DocsSection>

      <DocsSection id="gating" title="Protect premium routes">
        <DocsCodeBlock
          lang="ts"
          code={`export const requireEntitlement =
  (featureKey: string) => async (req, res, next) => {
    const companyId = String(req.headers["x-company-id"] ?? "");

    const result = await arcen.checkEntitlement(featureKey, { id: companyId });
    if (!result.enabled) {
      return res.status(403).json({ error: "Upgrade required" });
    }

    next();
  };`}
        />
      </DocsSection>

      <DocsSection id="usage" title="Consume metered usage">
        <DocsCodeBlock
          lang="ts"
          code={`app.post("/api/scan", async (req, res) => {
  const companyId = String(req.headers["x-company-id"] ?? "");

  const result = await arcen.consumeEntitlement({
    featureKey: "scan",
    company: { id: companyId },
    idempotencyKey: String(req.headers["x-request-id"] ?? ""),
  });

  if (!result.enabled || !result.consumed) {
    return res.status(403).json({ error: result.reason });
  }

  res.json({ ok: true });
});`}
        />
      </DocsSection>

      <DocsSection id="webhooks" title="Verify webhook deliveries">
        <DocsCodeBlock
          lang="ts"
          code={`import { verifyWebhookSignature } from "@arcenpay/node";

app.post("/api/arcenpay-webhook", express.text({ type: "*/*" }), (req, res) => {
  const signatureHeader = String(req.headers["x-meap-signature"] ?? "");
  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  if (!verifyWebhookSignature(req.body, signature, process.env.ARCENPAY_WEBHOOK_SECRET!)) {
    return res.status(401).send("Invalid signature");
  }

  res.json({ received: true });
});`}
        />
      </DocsSection>
    </DocsPage>
  );
}
