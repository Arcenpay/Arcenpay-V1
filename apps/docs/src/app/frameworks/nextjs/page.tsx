'use client';

import { useState } from 'react';
import DocImagePlaceholder from '../../_components/DocImagePlaceholder';

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="docs-codeblock">
      <div className="docs-codeblock-header">
        <span className="docs-codeblock-lang">{lang}</span>
        <button
          className="docs-codeblock-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

export default function NextJSPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Frameworks</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Next.js Integration</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="nextjs">
          Next.js works especially well with ArcenPay because you can keep
          access-token issuance, activation, and webhook verification inside
          route handlers while rendering the billing experience with the React
          SDK in the same app.
        </p>

        <h2 id="install">Install</h2>
        <CodeBlock
          lang="bash"
          code={`npm install @arcenpay/react
npm install @arcenpay/node`}
        />

        <h2 id="env">Environment</h2>
        <CodeBlock
          lang="env"
          code={`NEXT_PUBLIC_ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=cmp_xxxxxxxxx
ARCENPAY_API_KEY=api_live_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx
ARCENPAY_BASE_URL=https://dashboard.arcenpay.xyz`}
        />

        <h2 id="token-route">Access-token route</h2>
        <CodeBlock
          lang="ts"
          code={`import { ArcenClient } from '@arcenpay/node';
import { NextResponse } from 'next/server';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

export async function POST() {
  const session = await client.identify({
    company: { id: 'company_123' },
    user: { id: 'user_123' },
  });

  return NextResponse.json({ token: session.token });
}`}
        />

        <h2 id="provider">Client provider</h2>
        <CodeBlock
          lang="tsx"
          code={`'use client';
import { ArcenPayProvider } from '@arcenpay/react';

export function BillingProviders({
  children,
  accessToken,
}: {
  children: React.ReactNode;
  accessToken: string;
}) {
  return (
    <ArcenPayProvider token={accessToken}>
      {children}
    </ArcenPayProvider>
  );
}`}
        />

        <h2 id="portal">Portal surface</h2>
        <CodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from '@arcenpay/react';

<ArcenEmbed
  accessToken={token}
  componentId="cmp_123"
  initialView="portal"
/>`}
        />

        <DocImagePlaceholder
          title="Next.js Billing Route"
          description="Add a screenshot here that shows the billing page rendered inside your app router layout with ArcenEmbed visible."
          heightClassName="h-72"
        />

        <h2 id="checkout">Subscription activation route</h2>
        <CodeBlock
          lang="ts"
          code={`import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const response = await fetch(
    \`\${process.env.ARCENPAY_BASE_URL}/api/v1/subscriptions/activate\`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: \`Bearer \${process.env.ARCENPAY_API_KEY}\`,
      },
      body: JSON.stringify(body),
    },
  );

  return NextResponse.json(await response.json(), { status: response.status });
}`}
        />

        <h2 id="webhooks">Webhook route</h2>
        <CodeBlock
          lang="ts"
          code={`import { verifyWebhookSignature } from '@arcenpay/node';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get('x-meap-signature') ?? '';

  if (!verifyWebhookSignature(rawBody, signature, process.env.ARCENPAY_WEBHOOK_SECRET!)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  return NextResponse.json({ received: true });
}`}
        />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#nextjs">Next.js</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#install">Install</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#token-route">Access token</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#provider">Provider</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#portal">Portal</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#checkout">Activation route</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#webhooks">Webhooks</a></li>
        </ul>
      </nav>
    </div>
  );
}
