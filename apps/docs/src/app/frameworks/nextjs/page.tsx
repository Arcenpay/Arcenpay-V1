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

export default function NextJSPage() {
  return (
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">Frameworks</div>
        <div className="docs-page-title-row"><h1>Next.js Implementation</h1></div>

        <p className="docs-lead" id="nextjs">
          ArcenPay is fully compatible with Next.js App Router, supporting both Client Components (hooks) 
          and Server Components (verification).
        </p>

        <h2 id="setup">Project Setup</h2>
        <CodeBlock lang="bash" code={`npx create-next-app@latest
npm install @arcenpay/react @arcenpay/node wagmi viem`} />

        <h2 id="client-side">Client Side: Access Gating</h2>
        <p>Wrap your Root Layout with <code>ArcenPayProvider</code> and check status in your pages.</p>
        <CodeBlock lang="tsx" code={`"use client";
import { useSubscription } from '@arcenpay/react';

export default function PremiumDashboard() {
  const { status, loading } = useSubscription();

  if (loading) return <Skeleton />;
  if (status !== 'active') return <RedirectToCheckout />;

  return <PremiumContent />;
}`} />

        <h2 id="server-side">Server Side: Middleware</h2>
        <p>Use Middleware to block entire route segments for non-subscribers at the edge.</p>
        <CodeBlock lang="typescript" code={`// middleware.ts
import { NextResponse } from 'next/server'
import { ArcenPayClient } from '@arcenpay/node'

export async function middleware(request) {
  const wallet = request.cookies.get('user-wallet');
  const client = new ArcenPayClient({ rpcUrl: process.env.RPC_URL });

  const { isValid } = await client.verifySubscription(wallet);

  if (!isValid && request.nextUrl.pathname.startsWith('/premium')) {
    return NextResponse.redirect(new URL('/checkout', request.url))
  }
}`} />

        <h2 id="server-actions">Server Actions & API Routes</h2>
        <p>Verify payments inside Server Actions to ensure actions are only performed by paying customers.</p>
        <CodeBlock lang="typescript" code={`"use server";
import { client } from '@/lib/arcenpay';

export async function processSensitiveData() {
  const wallet = await getSessionWallet();
  const { isValid } = await client.verifySubscription(wallet);

  if (!isValid) throw new Error("Unauthorized");

  // Perform action...
}`} />

        <h2 id="feature-gating">Advanced: Feature Gating</h2>
        <p>Fetch decrypted configuration from Tableland/Lit Protocol on the server.</p>
        <CodeBlock lang="tsx" code={`export default async function FeatureLockedPage() {
  const flags = await client.getFeatureFlags(wallet);

  return (
    <div>
      {flags.ai_editor ? <Editor /> : <UpgradePrompt />}
    </div>
  );
}`} />

        <div className="docs-callout tip">
          <span className="docs-callout-icon">💡</span>
          <div>
            We recommend using <code>iron-session</code> or <code>next-auth</code> to persist the user&apos;s wallet
            address after the initial connection, reducing RPC calls on subsequent page loads.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#nextjs">Next.js</a></li>
          <li className="docs-toc-item"><a href="#setup">Setup</a></li>
          <li className="docs-toc-item"><a href="#client-side">Client Side</a></li>
          <li className="docs-toc-item"><a href="#server-side">Server Side</a></li>
          <li className="docs-toc-item"><a href="#server-actions">Server Actions</a></li>
        </ul>
      </nav>
    </div>
  );
}
