import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function ApiAuthPage() {
  return (
    <DocsPage
      eyebrow="API Reference"
      title="Authentication"
      summary="ArcenPay uses three different credential layers depending on where the action happens: a server-only API key, a browser-facing publishable key for the React provider, and short-lived access tokens for server-issued embed or session flows."
      toc={[
        { href: "#credentials", label: "Credential types" },
        { href: "#access-tokens", label: "Access tokens" },
        { href: "#usage", label: "Usage guidance" },
      ]}
    >
      <DocsSection id="credentials" title="Credential types">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Credential</th>
              <th>Where it belongs</th>
              <th>Use it for</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>api_...</code></td>
              <td>Server only</td>
              <td>Node SDK, company APIs, access-token minting, activation, and server checks.</td>
            </tr>
            <tr>
              <td><code>pk_...</code></td>
              <td>Browser</td>
              <td><code>ArcenPayProvider</code> plus client-side <code>identify()</code>.</td>
            </tr>
            <tr>
              <td>Short-lived token</td>
              <td>Browser or embed surface</td>
              <td>Explicit server-issued access for embed-only or delegated flows.</td>
            </tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection id="access-tokens" title="Mint a short-lived access token">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

const session = await client.identify({
  company: { id: "company_123", wallet: "0xabc..." },
  user: { id: "user_123", wallet: "0xabc..." },
  expiresIn: 3600,
});

return { token: session.token };`}
        />
      </DocsSection>

      <DocsSection id="usage" title="Usage guidance">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Keep <code>ARCENPAY_API_KEY</code> on trusted infrastructure only.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Prefer the publishable-key plus <code>identify()</code> flow for the
            standard React integration path.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Use short-lived tokens when your backend wants to explicitly control
            an embed session boundary.
          </li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
