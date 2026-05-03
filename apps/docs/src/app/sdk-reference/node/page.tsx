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

export default function NodeSDKPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Integrate</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Node.js SDK</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="node-sdk">
          <code>@arcenpay/node</code> is the supported backend SDK for public
          integrations. Use the high-level client for customer identify flows,
          entitlement checks, subscription activation, and webhook verification.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/node`} />

        <h2 id="initialization">Initialization</h2>
        <CodeBlock lang="typescript" code={`import { ArcenClient } from '@arcenpay/node';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL,
});`} />

        <h2 id="identify">Identify a company or user</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Call <code>identify()</code> once to mint a short-lived session token for follow-up checks.</p>
        <CodeBlock lang="typescript" code={`const session = await client.identify({
  company: { id: 'company_123', name: 'Acme' },
  user: { wallet: '0xabc...', email: 'owner@acme.com' },
  expiresIn: 3600,
});`} />

        <h2 id="entitlements">Check access</h2>
        <CodeBlock lang="typescript" code={`const entitlement = await client.checkEntitlement('analytics_export');

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

        <h2 id="webhooks">Verify webhook signatures</h2>
        <CodeBlock lang="typescript" code={`import { verifyWebhookSignature } from '@arcenpay/node';

const isValid = verifyWebhookSignature(
  rawRequestBody,
  String(req.headers['x-meap-signature']),
  process.env.ARCENPAY_WEBHOOK_SECRET!,
);

if (!isValid) {
  throw new Error('Invalid webhook signature');
}`} />

        <div className="docs-callout-warning mb-5">
          <span className="docs-callout-icon">🔒</span>
          <div>
            Keep your <code>ARCENPAY_API_KEY</code> on the server only. The browser
            should receive short-lived access tokens, never your workspace API key.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#node-sdk">Node.js SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#installation">Installation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#initialization">Initialization</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#identify">Identify</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#entitlements">Check access</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#activation">Activate subscription</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhooks</a></li>
        </ul>
      </nav>
    </div>
  );
}
