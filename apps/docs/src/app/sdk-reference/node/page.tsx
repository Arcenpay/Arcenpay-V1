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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Integrate</div>
        <div className="docs-page-title-row"><h1>Node.js SDK</h1></div>

        <p className="docs-lead" id="node-sdk">
          The <code>@arcenpay/node</code> SDK is designed for server-side verification, webhook handling, and 
          automated billing operations. It directly interacts with the ArcenPay smart contracts via a JSON-RPC provider.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/node viem`} />

        <h2 id="initialization">Initialization</h2>
        <CodeBlock lang="typescript" code={`import { ArcenPayClient } from '@arcenpay/node';

const client = new ArcenPayClient({
  rpcUrl: process.env.RPC_URL,
  privateKey: process.env.PROVIDER_PRIVATE_KEY, // Optional
});`} />

        <h2 id="verification">Verifying access</h2>
        <p>Use this in your API middleware or server-side functions to gate access to premium resources.</p>
        <CodeBlock lang="typescript" code={`async function gateAccess(req, res) {
  const walletAddress = req.headers['x-wallet-address'];

  const { isValid, plan } = await client.verifySubscription(walletAddress);

  if (!isValid) {
    return res.status(402).json({ error: 'Subscription Required' });
  }

  console.log('User tier:', plan.tier);
}`} />

        <h2 id="webhooks">Webhook verification</h2>
        <p>Ensure that requests to your webhook endpoint are genuinely from the ArcenPay network.</p>
        <CodeBlock lang="typescript" code={`const isValid = client.verifyWebhookSignature(
  req.body,
  req.headers['x-arcenpay-signature'],
  process.env.WEBHOOK_SECRET
);`} />

        <h2 id="billing-ops">Billing operations</h2>
        <p>If you aren&apos;t using the automated AutopayModule, you can trigger renewals manually for users who have granted approval.</p>
        <CodeBlock lang="typescript" code={`await client.triggerRenewal({
  subscriber: '0x...',
  planId: 1
});`} />

        <h2 id="reference">Method reference</h2>
        <table className="docs-table">
          <thead><tr><th>Method</th><th>Description</th></tr></thead>
          <tbody>
            <tr>
              <td><code>verifySubscription(address)</code></td>
              <td>Check on-chain state for a wallet. Returns validity and plan info.</td>
            </tr>
            <tr>
              <td><code>getFeatureFlags(address)</code></td>
              <td>Gets decrypted feature flag configuration for a user.</td>
            </tr>
            <tr>
              <td><code>listPlans()</code></td>
              <td>Fetch all plans registered to your provider address.</td>
            </tr>
            <tr>
              <td><code>getBillingHistory(address)</code></td>
              <td>Paginated list of all renewals and mints for a wallet.</td>
            </tr>
            <tr>
              <td><code>syncCrossChain(tokenId)</code></td>
              <td>Manually trigger a GMP update to secondary chains.</td>
            </tr>
          </tbody>
        </table>

        <div className="docs-callout warning">
          <span className="docs-callout-icon">🔒</span>
          <div>
            Never expose your <code>PROVIDER_PRIVATE_KEY</code> on the client side. Only use the Node.js SDK
            in secure, server-side environments.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#node-sdk">Node.js SDK</a></li>
          <li className="docs-toc-item"><a href="#installation">Installation</a></li>
          <li className="docs-toc-item"><a href="#initialization">Initialization</a></li>
          <li className="docs-toc-item"><a href="#verification">Verification</a></li>
          <li className="docs-toc-item"><a href="#webhooks">Webhooks</a></li>
          <li className="docs-toc-item"><a href="#reference">Method reference</a></li>
        </ul>
      </nav>
    </div>
  );
}
