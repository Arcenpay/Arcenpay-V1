import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../_components/DocsPrimitives";

export default function SDKReferencePage() {
  return (
    <DocsPage
      eyebrow="Developers"
      title="SDK reference"
      summary="The standard app integration path uses @arcenpay/react in the browser and @arcenpay/node on the server. The agent SDK is optional for x402-style autonomous payment flows, and @arcenpay/sdk is available when you intentionally need lower-level contract and chain helpers."
      toc={[
        { href: "#packages", label: "Packages" },
        { href: "#react-example", label: "React example" },
        { href: "#node-example", label: "Node example" },
        { href: "#boundary", label: "Recommended boundary" },
      ]}
    >
      <DocsSection id="packages" title="Packages">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Package</th>
              <th>Use it for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@arcenpay/react</code></td>
              <td>Provider setup, identify, ArcenEmbed, flags, entitlements, usage, and payment-link helpers.</td>
            </tr>
            <tr>
              <td><code>@arcenpay/node</code></td>
              <td>API-key auth, access tokens, company APIs, subscription activation, access checks, and webhooks.</td>
            </tr>
            <tr>
              <td><code>@arcenpay/agent</code></td>
              <td>Optional autonomous payment flows for bots, workers, MCP tools, and agent workloads.</td>
            </tr>
            <tr>
              <td><code>@arcenpay/sdk</code></td>
              <td>Shared types, ABIs, chain config, addresses, and low-level helpers for advanced integrations.</td>
            </tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection id="react-example" title="React example">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenPayProvider, ArcenEmbed } from "@arcenpay/react";

export function BillingSurface() {
  return (
    <ArcenPayProvider
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
    >
      <ArcenEmbed mode="modal" />
    </ArcenPayProvider>
  );
}`}
        />
      </DocsSection>

      <DocsSection id="node-example" title="Node example">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

await client.identify({
  company: { id: "company_123", wallet: "0xabc..." },
  user: { id: "user_123", wallet: "0xabc..." },
});

const result = await client.checkEntitlement("scan");
console.log(result.enabled);`}
        />
      </DocsSection>

      <DocsSection id="boundary" title="Recommended boundary">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Use the dashboard for plans, add-ons, components, payment links,
            invoices, webhooks, and workspace settings.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Use the React SDK for customer-facing billing experiences and
            lightweight UI state.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Use the Node SDK for every action that should stay behind your
            server boundary.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Reach for <code>@arcenpay/sdk</code> only when you explicitly need
            contract-aware or chain-aware behavior.
          </li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
