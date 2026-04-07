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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Integrate</div>
        <div className="docs-page-title-row"><h1>Webhooks</h1></div>

        <p className="docs-lead" id="webhooks">
          Webhooks allow you to receive real-time notifications for events on the ArcenPay network,
          such as company identity updates, subscription lifecycle changes, and invoice events.
        </p>

        <h2 id="overview">How webhooks work</h2>
        <p>
          When a transaction completes on the ArcenPay protocol (e.g., in the <code>SubscriptionRegistry</code>), 
          our indexing service detects the event and dispatches a JSON payload to your configured endpoint.
        </p>

        <h2 id="setup">Configuring endpoints</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Enter your URL</div>
              <p className="docs-step-desc">Go to the Dashboard &gt; Developers &gt; Webhooks and add your public endpoint URL (e.g., <code>https://api.myapp.com/webhooks/arcenpay</code>).</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Select events</div>
              <p className="docs-step-desc">Choose which billing lifecycle events you want to listen to.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Save secret</div>
              <p className="docs-step-desc">Copy the signing secret (starting with <code>whsec_</code>) and store it in your environment variables.</p>
            </div>
          </div>
        </div>

        <h2 id="event-types">Event types</h2>
        <table className="docs-table">
          <thead><tr><th>Event Type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>company.created</code></td><td>A company record was auto-created or identified.</td></tr>
            <tr><td><code>user.created</code></td><td>A user record was created or identified for a company.</td></tr>
            <tr><td><code>company.plan.changed</code></td><td>A company moved to a different plan.</td></tr>
            <tr><td><code>company.plan.cancelled</code></td><td>A company plan was cancelled or removed.</td></tr>
            <tr><td><code>subscription.minted</code></td><td>A new on-chain subscription was minted.</td></tr>
            <tr><td><code>subscription.renewed</code></td><td>An on-chain subscription renewed successfully.</td></tr>
            <tr><td><code>subscription.auto_renewed</code></td><td>The automated renewal keeper completed a renewal.</td></tr>
            <tr><td><code>subscription.renewal_failed</code></td><td>An automatic renewal attempt failed.</td></tr>
            <tr><td><code>invoice.issued</code></td><td>An invoice was created for a subscription charge.</td></tr>
            <tr><td><code>invoice.delivery_failed</code></td><td>An invoice email could not be delivered.</td></tr>
            <tr><td><code>invoice.paid</code></td><td>An invoice was marked paid.</td></tr>
          </tbody>
        </table>

        <h2 id="payload">Payload example</h2>
        <CodeBlock lang="json" code={`{
  "id": "evt_123456789",
  "event": "subscription.renewed",
  "created": "2026-04-04T10:30:00.000Z",
  "data": {
    "companyId": "cmp_123",
    "wallet": "0x40d5...2b91",
    "tokenId": "42",
    "planId": "starter",
    "txHash": "0xabc123..."
  }
}`} />

        <h2 id="security">Verifying signatures</h2>
        <p>Always verify the signature using the <code>@arcenpay/node</code> SDK to prevent spoofing.</p>
        <CodeBlock lang="typescript" code={`import { ArcenPayClient } from '@arcenpay/node';

const client = new ArcenPayClient();

// In your route handler
const signature = req.headers['x-meap-signature'];
const event = req.headers['x-meap-event'];
const timestamp = req.headers['x-meap-timestamp'];
const payload = JSON.stringify(req.body);

try {
  client.verifyWebhook(payload, signature, process.env.WEBHOOK_SECRET);
  // Payload is authentic
} catch (e) {
  // Fraudulent request
  return res.status(400).send("Invalid signature");
}`} />

        <h2 id="best-practices">Best practices</h2>
        <ul>
          <li><strong>Idempotency:</strong> Always check if you have already processed the event <code>id</code>. Network issues may cause duplicate deliveries.</li>
          <li><strong>Acknowledge quickly:</strong> Return a <code>200 OK</code> immediately before processing the logic to avoid timeouts.</li>
          <li><strong>Re-sync:</strong> If your server goes down, use our <code>sync</code> API to fetch missed events for a specific period.</li>
        </ul>

        <div className="docs-callout warning">
          <span className="docs-callout-icon">⚠️</span>
          <div>
            Webhooks are delivered with standard retry logic (exponential backoff). We will attempt delivery 5 times over 48 hours.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#webhooks">Webhooks</a></li>
          <li className="docs-toc-item"><a href="#overview">Overview</a></li>
          <li className="docs-toc-item"><a href="#setup">Setup</a></li>
          <li className="docs-toc-item"><a href="#event-types">Event types</a></li>
          <li className="docs-toc-item"><a href="#payload">Payload</a></li>
          <li className="docs-toc-item"><a href="#security">Signature verification</a></li>
        </ul>
      </nav>
    </div>
  );
}
