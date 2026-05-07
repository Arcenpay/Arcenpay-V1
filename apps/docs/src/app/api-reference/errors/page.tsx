import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ApiErrorsPage() {
  return (
    <DocsPage
      eyebrow="API Reference"
      title="Errors"
      summary="ArcenPay uses conventional HTTP status codes plus SDK-specific error types. Most server-side failures surface as ArcenApiError, while low-level contract-aware integrations can also use the core SDK error helpers."
      toc={[
        { href: "#http", label: "HTTP status codes" },
        { href: "#node", label: "Node SDK errors" },
        { href: "#webhooks", label: "Webhook verification" },
        { href: "#core", label: "Core helpers" },
      ]}
    >
      <DocsSection id="http" title="Common HTTP status codes">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>400</code></td><td>Malformed request body or missing parameters.</td></tr>
            <tr><td><code>401</code></td><td>Missing or invalid auth credentials.</td></tr>
            <tr><td><code>403</code></td><td>The customer is not entitled to the requested action.</td></tr>
            <tr><td><code>404</code></td><td>The requested resource does not exist.</td></tr>
            <tr><td><code>409</code></td><td>The requested action conflicts with current billing state.</td></tr>
            <tr><td><code>500</code></td><td>Unexpected server-side failure.</td></tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection id="node" title="Handle Node SDK errors">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenApiError } from "@arcenpay/node";

try {
  await client.activateSubscription({
    planId: "starter",
    paymentAccount: "0xabc...",
    company: { id: "company_123" },
  });
} catch (error) {
  if (error instanceof ArcenApiError) {
    console.error(error.statusCode, error.message);
  }
}`}
        />
      </DocsSection>

      <DocsSection id="webhooks" title="Webhook verification failures">
        <DocsCodeBlock
          lang="ts"
          code={`const signatureHeader = req.headers.get("x-meap-signature") ?? "";
const signature = signatureHeader.replace(/^sha256=/, "");

if (!verifyWebhookSignature(rawBody, signature, secret)) {
  return new Response("Invalid signature", { status: 401 });
}`}
        />
      </DocsSection>

      <DocsSection id="core" title="Low-level core SDK helpers">
        <DocsCodeBlock
          lang="ts"
          code={`import { parseContractError, normalizeError } from "@arcenpay/sdk";

try {
  await contractCall();
} catch (error) {
  console.log(parseContractError(error));
  console.log(normalizeError(error));
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
