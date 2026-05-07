'use client';
import { useState } from 'react';
import DocImagePlaceholder from '../_components/DocImagePlaceholder';

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
          Webhooks keep your app in sync with ArcenPay billing activity. Use
          them to react to subscription changes, invoice state updates, and
          other customer billing events without polling the dashboard.
        </p>

        <h2 id="setup">Dashboard setup</h2>
        <div className="docs-steps">
          <div className="docs-step">
            <div className="docs-step-num">1</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Add your endpoint URL</div>
              <p className="docs-step-desc">Register the public webhook endpoint in your ArcenPay dashboard settings.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">2</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Store the signing secret</div>
              <p className="docs-step-desc">Save the generated <code>whsec_...</code> value on your server as <code>ARCENPAY_WEBHOOK_SECRET</code>.</p>
            </div>
          </div>
          <div className="docs-step">
            <div className="docs-step-num">3</div>
            <div className="docs-step-body">
              <div className="docs-step-title">Verify every request</div>
              <p className="docs-step-desc">Reject any webhook whose signature does not match the raw request body.</p>
            </div>
          </div>
        </div>

        <DocImagePlaceholder
          title="Webhook Configuration Screen"
          description="Add a screenshot here of the dashboard webhook settings screen, including the endpoint form and where the signing secret is shown."
          heightClassName="h-72"
        />

        <h2 id="events">Common event types</h2>
        <table className="docs-table">
          <thead><tr><th>Event type</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>company.plan.changed</code></td><td>A customer changed plans.</td></tr>
            <tr><td><code>company.plan.cancelled</code></td><td>A recurring billing relationship was cancelled.</td></tr>
            <tr><td><code>invoice.issued</code></td><td>A new invoice was created.</td></tr>
            <tr><td><code>invoice.paid</code></td><td>An invoice was marked paid.</td></tr>
            <tr><td><code>invoice.delivery_failed</code></td><td>Invoice delivery failed and may need operator attention.</td></tr>
          </tbody>
        </table>

        <h2 id="verify">Signature verification</h2>
        <CodeBlock lang="typescript" code={`import { verifyWebhookSignature } from '@arcenpay/node';

const rawBody = await req.text();
const signature = String(req.headers['x-meap-signature'] ?? '');

const isValid = verifyWebhookSignature(
  rawBody,
  signature,
  process.env.ARCENPAY_WEBHOOK_SECRET!,
);

if (!isValid) {
  throw new Error('Invalid signature');
}`} />

        <h2 id="best-practices">Best practices</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Verify before parsing business meaning:</strong> treat the raw request body plus signature as the source of truth.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Use idempotency:</strong> store event ids so retried deliveries do not duplicate work.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed"><strong>Acknowledge quickly:</strong> return success fast, then continue longer work asynchronously when possible.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#webhooks">Webhooks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#events">Events</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#verify">Verify</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#best-practices">Best practices</a></li>
        </ul>
      </nav>
    </div>
  );
}
