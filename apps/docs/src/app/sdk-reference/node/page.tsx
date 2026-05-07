'use client';
import { useState } from 'react';
import DocImagePlaceholder from '../../_components/DocImagePlaceholder';

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

export default function NodeSDKPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Integrate</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Node.js SDK</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="node-sdk">
          <code>@arcenpay/node</code> is the server-side SDK for ArcenPay. It
          should own every action that uses your API key or makes billing
          decisions on behalf of your app.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/node`} />

        <h2 id="client">Create the client</h2>
        <CodeBlock lang="typescript" code={`import { ArcenClient } from '@arcenpay/node';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});`} />

        <h2 id="identify">Mint a short-lived access token</h2>
        <CodeBlock lang="typescript" code={`const session = await client.identify({
  company: { id: 'company_123', name: 'Acme' },
  user: { id: 'user_123', email: 'owner@acme.com' },
  expiresIn: 3600,
});

return { token: session.token };`} />

        <h2 id="entitlements">Check access</h2>
        <CodeBlock lang="typescript" code={`const entitlement = await client.checkEntitlement(
  'analytics_export',
  { id: 'company_123' },
);

if (!entitlement.enabled) {
  throw new Error('Upgrade required');
}`} />

        <h2 id="activation">Activate a subscription</h2>
        <CodeBlock lang="typescript" code={`const result = await client.activateSubscription({
  planId: 'starter-monthly',
  paymentAccount: '0xabc...',
  company: { id: 'company_123' },
  subscriberEmail: 'owner@acme.com',
});`} />

        <DocImagePlaceholder
          title="Backend Flow Screenshot or Diagram"
          description="Add a visual here that shows your token route, subscription activation route, and webhook route inside your backend or API router structure."
          heightClassName="h-64"
        />

        <h2 id="webhooks">Verify webhook signatures</h2>
        <CodeBlock lang="typescript" code={`import { verifyWebhookSignature } from '@arcenpay/node';

const signature = String(req.headers['x-meap-signature'] ?? '');

const isValid = verifyWebhookSignature(
  rawRequestBody,
  signature,
  process.env.ARCENPAY_WEBHOOK_SECRET!,
);

if (!isValid) {
  throw new Error('Invalid webhook signature');
}`} />

        <h2 id="types">Types</h2>
        <CodeBlock lang="typescript" code={`import type {
  IdentifyResult,
  EntitlementResult,
  ConsumeEntitlementResult,
  FlagResult,
} from '@arcenpay/node';`} />

        <div className="docs-callout-warning mb-5">
          <span className="docs-callout-icon">🔒</span>
          <div>
            Keep <code>ARCENPAY_API_KEY</code> on the server only. The browser
            should receive short-lived access tokens, never your workspace API
            key.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#node-sdk">Node.js SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#installation">Installation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#client">Client</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#identify">Identify</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#entitlements">Entitlements</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#activation">Activation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhooks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#types">Types</a></li>
        </ul>
      </nav>
    </div>
  );
}
