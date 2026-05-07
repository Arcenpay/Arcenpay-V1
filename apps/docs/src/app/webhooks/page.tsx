import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../_components/DocsPrimitives";

export default function WebhooksPage() {
  return (
    <DocsPage
      eyebrow="Integrate"
      title="Webhooks"
      summary="Webhooks keep your app in sync with ArcenPay billing activity. Use them for company creation, plan changes, subscription lifecycle events, invoice events, and renewal outcomes without polling the dashboard."
      toc={[
        { href: "#setup", label: "Setup" },
        { href: "#events", label: "Event types" },
        { href: "#verify", label: "Verify signatures" },
        { href: "#practices", label: "Best practices" },
      ]}
    >
      <DocsSection id="setup" title="Set up the endpoint">
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Register your public webhook URL in the dashboard.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Store the generated <code>whsec_...</code> secret on the server as
            <code> ARCENPAY_WEBHOOK_SECRET</code>.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Verify the raw body plus <code>X-MEAP-Signature</code> header before
            acting on the event.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="events" title="Common event types">
        <table className="docs-table">
          <thead>
            <tr>
              <th>Event</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>company.created</code></td><td>A company record was created or first identified.</td></tr>
            <tr><td><code>user.created</code></td><td>A user record was created or first identified.</td></tr>
            <tr><td><code>company.plan.changed</code></td><td>The active plan changed.</td></tr>
            <tr><td><code>company.plan.cancelled</code></td><td>A company&apos;s plan or subscription was cancelled.</td></tr>
            <tr><td><code>subscription.minted</code></td><td>A new on-chain subscription was created.</td></tr>
            <tr><td><code>subscription.renewed</code></td><td>An existing subscription renewed successfully.</td></tr>
            <tr><td><code>subscription.auto_renewed</code></td><td>The renewal keeper completed an automated renewal.</td></tr>
            <tr><td><code>subscription.renewal_failed</code></td><td>An automated renewal failed.</td></tr>
            <tr><td><code>invoice.issued</code></td><td>An invoice was created.</td></tr>
            <tr><td><code>invoice.delivery_failed</code></td><td>Invoice delivery failed.</td></tr>
            <tr><td><code>invoice.paid</code></td><td>An invoice was marked paid.</td></tr>
          </tbody>
        </table>
      </DocsSection>

      <DocsSection id="verify" title="Verify signatures">
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
  throw new Error("Invalid signature");
}`}
        />
      </DocsSection>

      <DocsSection id="practices" title="Best practices">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Verify before parsing business meaning.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Store an idempotency key or event id so retries do not duplicate work.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Acknowledge quickly, then do slower downstream work asynchronously.
          </li>
        </ul>
      </DocsSection>
    </DocsPage>
  );
}
