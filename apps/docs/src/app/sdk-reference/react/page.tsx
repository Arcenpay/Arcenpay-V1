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

export default function ReactSDKPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Integrate</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>React SDK</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="react-sdk">
          <code>@arcenpay/react</code> is the main customer-facing SDK for
          ArcenPay. Use it for checkout, embedded billing portals, entitlement
          checks in UI, usage-aware screens, and dashboard-managed billing
          surfaces.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/react`} />

        <h2 id="setup">Setup</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The normal pattern is: mint a short-lived access token on your
          backend, then pass that token into <code>ArcenPayProvider</code>.
        </p>
        <CodeBlock lang="tsx" code={`import { ArcenPayProvider } from '@arcenpay/react';

function App({ accessToken }: { accessToken: string }) {
  return (
    <ArcenPayProvider token={accessToken}>
      <YourAppContent />
    </ArcenPayProvider>
  );
}`} />

        <DocImagePlaceholder
          title="React SDK in a Real App"
          description="Add a screenshot here that shows the billing route inside your app shell, not just the isolated component."
          heightClassName="h-72"
        />

        <h2 id="embeds">Embedded billing portal</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          ArcenEmbed renders a published dashboard component for the current
          customer context. This is the fastest way to ship a self-serve billing
          area.
        </p>
        <CodeBlock lang="tsx" code={`import { ArcenEmbed } from '@arcenpay/react';

<ArcenEmbed
  accessToken={embedToken}
  componentId="cmp_123"
  initialView="portal"
/>`} />

        <h2 id="checkout">Recurring checkout</h2>
        <CodeBlock lang="tsx" code={`import { CheckoutModal } from '@arcenpay/react';

<CheckoutModal
  planId={1n}
  isOpen={showCheckout}
  onClose={() => setShowCheckout(false)}
  activationEndpoint="/api/request-subscription"
/>`} />

        <h2 id="hooks">Useful hooks</h2>
        <CodeBlock lang="tsx" code={`import {
  useEntitlementCheck,
  useConsumeEntitlement,
  useTrack,
} from '@arcenpay/react';

const { enabled } = useEntitlementCheck('analytics_export');
const { consume } = useConsumeEntitlement();
const { track } = useTrack();`} />

        <h2 id="types">Types</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          If you need React-side ArcenPay types, import them from
          <code> @arcenpay/react </code>
          directly.
        </p>
        <CodeBlock lang="ts" code={`import type {
  ComponentRenderData,
  InvoiceSummary,
  EntitlementResult,
} from '@arcenpay/react';`} />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#react-sdk">React SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#installation">Installation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#embeds">Embeds</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#checkout">Checkout</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#hooks">Hooks</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#types">Types</a></li>
        </ul>
      </nav>
    </div>
  );
}
