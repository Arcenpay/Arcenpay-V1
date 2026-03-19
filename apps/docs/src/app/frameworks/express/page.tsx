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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Frameworks</div>
        <div className="docs-page-title-row"><h1>Express Implementation</h1></div>

        <p className="docs-lead" id="express">
          Integrate ArcenPay into your Node.js Express server using our middleware for 
          easy route protection and subscription validation.
        </p>

        <h2 id="setup">Project Setup</h2>
        <CodeBlock lang="bash" code={`npm install express @meap/node`} />

        <h2 id="middleware">The Gating Middleware</h2>
        <p>Create a reusable middleware function to protect your premium routes.</p>
        <CodeBlock lang="typescript" code={`import { MEAPClient } from '@meap/node';

const client = new MEAPClient({ rpcUrl: process.env.RPC_URL });

export const requireSubscription = async (req, res, next) => {
  const wallet = req.headers['x-user-wallet'];
  
  if (!wallet) {
    return res.status(401).json({ error: 'Missing wallet header' });
  }

  const { isValid } = await client.verifySubscription(wallet);

  if (!isValid) {
    return res.status(402).json({ 
      error: 'Payment Required', 
      checkoutUrl: 'https://app.arcenpay.com/checkout/...' 
    });
  }

  next();
};`} />

        <h2 id="usage">Usage in Routes</h2>
        <CodeBlock lang="typescript" code={`import express from 'express';
import { requireSubscription } from './middleware';

const app = express();

app.get('/api/free-content', (req, res) => {
  res.send('Everyone can see this.');
});

app.get('/api/premium-content', requireSubscription, (req, res) => {
  res.send('This is for paying subscribers only.');
});

app.listen(3000);`} />

        <h2 id="scoped-access">Tier-scoped Access</h2>
        <p>You can also create middleware that requires a specific plan tier (e.g., &quot;pro&quot;).</p>
        <CodeBlock lang="typescript" code={`export const requireTier = (targetTier: string) => async (req, res, next) => {
  const wallet = req.headers['x-user-wallet'];
  const { isValid, plan } = await client.verifySubscription(wallet);

  if (!isValid || plan.tier !== targetTier) {
    return res.status(403).json({ error: \`Requires \${targetTier} tier\` });
  }

  next();
};

app.get('/api/enterprise-only', requireTier('enterprise'), (req, res) => {
  res.send('Welcome, enterprise user.');
});`} />

        <h2 id="webhooks">Webhook integration</h2>
        <p>Express makes it simple to handle incoming billing events from the ArcenPay network.</p>
        <CodeBlock lang="typescript" code={`app.post('/api/arcenpay-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-arcenpay-signature'];
  
  try {
    const event = client.verifyWebhook(req.body, signature, process.env.WEBHOOK_SECRET);
    
    if (event.type === 'subscription.renewed') {
      console.log('User renewed:', event.data.subscriber);
    }
    
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(\`Webhook Error: \${err.message}\`);
  }
});`} />

        <div className="docs-callout info">
          <span className="docs-callout-icon">💡</span>
          <div>
            Pro-tip: Use <code>express-rate-limit</code> alongside ArcenPay to prevent automated scraping
            even by valid subscribers.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#express">Express</a></li>
          <li className="docs-toc-item"><a href="#setup">Setup</a></li>
          <li className="docs-toc-item"><a href="#middleware">Gating Middleware</a></li>
          <li className="docs-toc-item"><a href="#usage">Usage</a></li>
          <li className="docs-toc-item"><a href="#scoped-access">Tier-scoped access</a></li>
          <li className="docs-toc-item"><a href="#webhooks">Webhooks</a></li>
        </ul>
      </nav>
    </div>
  );
}
