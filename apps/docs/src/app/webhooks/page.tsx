'use client';
import { useState } from 'react';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button className="docs-codeblock-copy" onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function WebhooksPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Integrate</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Webhooks</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="webhooks">
          Webhooks let your app react to subscription, invoice, and hosted
          payment activity without polling the dashboard.
        </p>

        <h2 id="overview">How webhooks work</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          When ArcenPay records a billing event, it sends a signed JSON payload
          to the endpoint you configured in the dashboard.
        </p>

        <h2 id="setup">Configuring endpoints</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Add your endpoint URL</div>
              <p className="docs-step-desc">Go to Dashboard → Settings → Notifications and add your public webhook endpoint.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Select the events you care about</div>
              <p className="docs-step-desc">Start with subscription, invoice, and payment-link activity relevant to your app.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Store the signing secret</div>
              <p className="docs-step-desc">Save the generated <code>whsec_...</code> secret in your server environment.</p>
            </div>
          </div>
        </div>

        <h2 id="event-types">Common event types</h2>
        <table className="docs-table">
          <thead><tr><th>Event type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>company.plan.changed</code></td><td>A customer moved to a different plan.</td></tr>
            <tr><td><code>company.plan.cancelled</code></td><td>A customer's recurring plan was cancelled.</td></tr>
            <tr><td><code>invoice.issued</code></td><td>An invoice was created.</td></tr>
            <tr><td><code>invoice.delivery_failed</code></td><td>An invoice email could not be delivered.</td></tr>
            <tr><td><code>invoice.paid</code></td><td>An invoice was confirmed as paid.</td></tr>
          </tbody>
        </table>

        <h2 id="payload">Payload example</h2>
        <CodeBlock lang="json" code={`{
  "id": "evt_123456789",
  "event": "invoice.paid",
  "created": "2026-05-03T11:42:00.000Z",
  "data": {
    "invoiceId": "inv_123",
    "invoiceNumber": "INV-1007",
    "customerEmail": "owner@acme.com",
    "status": "PAID"
  }
}`} />

        <h2 id="security">Verify signatures</h2>
        <CodeBlock lang="typescript" code={`import { verifyWebhookSignature } from '@arcenpay/node';

const isValid = verifyWebhookSignature(
  rawRequestBody,
  String(req.headers['x-meap-signature']),
  process.env.ARCENPAY_WEBHOOK_SECRET!,
);

if (!isValid) {
  throw new Error('Invalid signature');
}`} />

        <h2 id="best-practices">Best practices</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Verify every request:</strong> Always validate the webhook signature before processing.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Handle retries safely:</strong> Use the event <code>id</code> as your idempotency key.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Acknowledge quickly:</strong> Return <code>200 OK</code> before running long background work.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#webhooks">Webhooks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#overview">Overview</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#event-types">Event types</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#payload">Payload</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#security">Security</a></li>
        </ul>
      </nav>
    </div>
  );
}
