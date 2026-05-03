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

export default function ExpressPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Frameworks</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Express Integration</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="express">
          Use the Node SDK inside your Express server to verify access, create
          secure billing workflows, and validate webhook deliveries from ArcenPay.
        </p>

        <h2 id="setup">Project setup</h2>
        <CodeBlock lang="bash" code={`npm install express @arcenpay/node`} />

        <h2 id="client">Create the Arcen client</h2>
        <CodeBlock lang="typescript" code={`import { ArcenClient } from '@arcenpay/node';

export const arcen = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL,
});`} />

        <h2 id="middleware">Protect premium routes</h2>
        <CodeBlock lang="typescript" code={`export const requireEntitlement = (featureKey: string) => async (req, res, next) => {
  await arcen.identify({
    company: { id: req.headers['x-company-id'] as string },
    user: { wallet: req.headers['x-user-wallet'] as string },
  });

  const result = await arcen.checkEntitlement(featureKey);
  if (!result.enabled) {
    return res.status(403).json({ error: 'Upgrade required' });
  }

  next();
};`} />

        <h2 id="usage">Use the middleware in routes</h2>
        <CodeBlock lang="typescript" code={`import express from 'express';
import { requireEntitlement } from './billing';

const app = express();

app.get('/api/free-content', (_req, res) => {
  res.send('Everyone can see this.');
});

app.get('/api/premium-content', requireEntitlement('analytics_export'), (_req, res) => {
  res.send('This is for paying customers only.');
});`} />

        <h2 id="webhooks">Webhook verification</h2>
        <CodeBlock lang="typescript" code={`import { verifyWebhookSignature } from '@arcenpay/node';

app.post('/api/arcenpay-webhook', express.text({ type: '*/*' }), (req, res) => {
  const signature = String(req.headers['x-meap-signature'] ?? '');

  if (!verifyWebhookSignature(req.body, signature, process.env.ARCENPAY_WEBHOOK_SECRET!)) {
    return res.status(400).send('Invalid signature');
  }

  res.json({ received: true });
});`} />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#express">Express</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#client">Client</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#middleware">Middleware</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#usage">Usage</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhooks</a></li>
        </ul>
      </nav>
    </div>
  );
}
