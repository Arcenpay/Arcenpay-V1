'use client';

import { useState } from 'react';
import DocImagePlaceholder from '../_components/DocImagePlaceholder';

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

export default function SDKReferencePage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Developers</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>SDK Reference</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="sdk-reference">
          The main ArcenPay platform path uses two public SDKs:
          <code> @arcenpay/react </code>
          for customer-facing UI and
          <code> @arcenpay/node </code>
          for secure backend workflows. App developers should not need to
          depend on low-level packages for normal integrations.
        </p>

        <DocImagePlaceholder
          title="SDK Relationship Diagram"
          description="Add a diagram or annotated screenshot here that shows which responsibilities belong to the dashboard, the React SDK, and the Node SDK."
          heightClassName="h-64"
        />

        <h2 id="packages">Packages</h2>
        <table className="docs-table">
          <thead>
            <tr><th>Package</th><th>Use it for</th><th>Install</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>@arcenpay/react</code></td>
              <td>Checkout, ArcenEmbed, billing surfaces, usage-aware UI, flags, and entitlement hooks</td>
              <td><code>npm install @arcenpay/react</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/node</code></td>
              <td>Access-token minting, entitlement checks, subscription activation, usage tracking, and webhook verification</td>
              <td><code>npm install @arcenpay/node</code></td>
            </tr>
            <tr>
              <td><code>@arcenpay/agent</code></td>
              <td>Optional agent-to-service payment flows for autonomous x402 use cases</td>
              <td><code>Optional add-on</code></td>
            </tr>
          </tbody>
        </table>

        <h2 id="react">React SDK example</h2>
        <CodeBlock
          lang="tsx"
          code={`import { ArcenPayProvider, ArcenEmbed } from '@arcenpay/react';

export function BillingSurface({ token }: { token: string }) {
  return (
    <ArcenPayProvider token={token}>
      <ArcenEmbed componentId="cmp_123" initialView="portal" />
    </ArcenPayProvider>
  );
}`}
        />

        <h2 id="node">Node SDK example</h2>
        <CodeBlock
          lang="ts"
          code={`import { ArcenClient } from '@arcenpay/node';

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL,
});

const session = await client.identify({
  company: { id: 'company_123' },
  user: { id: 'user_123' },
});

const entitlement = await client.checkEntitlement(
  'analytics_export',
  { id: 'company_123' },
);`}
        />

        <h2 id="types">Type imports</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          If you need ArcenPay input or result types in application code, import
          them from the public package you are already using.
        </p>
        <CodeBlock
          lang="ts"
          code={`import type {
  IdentifyResult,
  EntitlementResult,
  ConsumeEntitlementResult,
} from '@arcenpay/node';

import type {
  ComponentRenderData,
  InvoiceSummary,
} from '@arcenpay/react';`}
        />

        <h2 id="recommended-boundary">Recommended integration boundary</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the dashboard for plans, components, invoices, webhooks, and customer operations.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the React SDK for the customer-facing billing experience.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the Node SDK for every action that should stay behind your server boundary.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Treat the agent SDK as a separate product surface, not part of the default app integration path.</li>
        </ul>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#sdk-reference">SDK Reference</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#packages">Packages</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react">React</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#node">Node</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#types">Types</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#recommended-boundary">Boundary</a></li>
        </ul>
      </nav>
    </div>
  );
}
