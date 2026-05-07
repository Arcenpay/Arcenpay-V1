import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function NodeSDKPage() {
  return (
    <DocsPage
      eyebrow="Integrate"
      title="Node.js SDK"
      summary="Use @arcenpay/node for every ArcenPay action that should stay on trusted infrastructure: API-key auth, access-token minting, company APIs, subscription activation, access checks, usage consumption, and signed webhook verification."
      toc={[
        { href: "#install", label: "Install" },
        { href: "#client", label: "Client" },
        { href: "#identify", label: "Access tokens" },
        { href: "#checks", label: "Checks and usage" },
        { href: "#companies", label: "Company APIs" },
        { href: "#activation", label: "Activation" },
        { href: "#webhooks", label: "Webhooks" },
      ]}
    >
      <DocsSection id="install" title="Install">
        <DocsCodeBlock lang="bash" code={`npm install @arcenpay/node`} />
      </DocsSection>

      <DocsSection id="client" title="Create the client">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});`}
        />
      </DocsSection>

      <DocsSection id="identify" title="Mint a short-lived access token">
        <DocsCodeBlock
          lang="ts"
          code={`const session = await client.identify({
  company: { id: "company_123", wallet: "0xabc...", name: "Acme" },
  user: { id: "user_123", wallet: "0xabc..." },
  expiresIn: 3600,
});

console.log(session.token);
console.log(session.expiresAt);`}
        />
      </DocsSection>

      <DocsSection id="checks" title="Run access checks and usage actions">
        <DocsCodeBlock
          lang="ts"
          code={`const flag = await client.checkFlag("scan", { id: "company_123" });
const entitlement = await client.checkEntitlement("scan", { id: "company_123" });
const consumed = await client.consumeEntitlement({
  featureKey: "scan",
  company: { id: "company_123" },
  idempotencyKey: "scan-req-1",
});

await client.track({
  name: "scan_started",
  company: { id: "company_123" },
  traits: { source: "api" },
});`}
        />
      </DocsSection>

      <DocsSection id="companies" title="Work with companies on the server">
        <DocsCodeBlock
          lang="ts"
          code={`const companies = await client.listCompanies({ limit: 20 });
const company = await client.getCompany("cm_company_123");

await client.createCompany({
  id: "company_456",
  name: "Northwind",
  wallet: "0xdef...",
});

await client.updateCompany("cm_company_123", {
  activePlanId: "starter",
});`}
        />
      </DocsSection>

      <DocsSection id="activation" title="Activate a subscription">
        <DocsCodeBlock
          lang="ts"
          code={`const result = await client.activateSubscription({
  planId: "starter",
  paymentAccount: "0xabc...",
  company: { id: "company_123", wallet: "0xabc..." },
  subscriberEmail: "owner@acme.com",
});

console.log(result.txHash);`}
        />
      </DocsSection>

      <DocsSection id="webhooks" title="Verify webhook signatures">
        <DocsCodeBlock
          lang="ts"
          code={`import { verifyWebhookSignature } from "@arcenpay/node";

const rawBody = await req.text();
const signatureHeader = req.headers.get("x-meap-signature") ?? "";
const signature =
  signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

if (!verifyWebhookSignature(rawBody, signature, process.env.ARCENPAY_WEBHOOK_SECRET!)) {
  throw new Error("Invalid webhook signature");
}`}
        />
        <p className="text-[15px] text-muted-foreground leading-relaxed mt-[15px] mb-0">
          The package also exports advanced optional services such as
          <code> x402Middleware</code>, <code>WebhookService</code>,
          <code>BillingKeeper</code>, and proof or settlement helpers for teams
          that want lower-level runtime control.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
