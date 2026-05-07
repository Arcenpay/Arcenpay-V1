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

export default function ApiAuthPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">API Reference</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Authentication</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="auth">
          ArcenPay uses a two-layer auth model. Your server authenticates with a
          long-lived workspace API key, and your browser uses short-lived access
          tokens that your backend issues for the current company or user.
        </p>

        <h2 id="api-key">Server-side API key</h2>
        <CodeBlock
          lang="bash"
          code={`curl "https://dashboard.arcenpay.xyz/api/v1/entitlements/check" \\
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json"`}
        />

        <h2 id="access-token">Short-lived access token</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          The browser should never receive your API key. Instead, your backend
          identifies the current company or user and returns a token that the
          React SDK can use.
        </p>
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
  expiresIn: 3600,
});

return { token: session.token };`}
        />

        <DocImagePlaceholder
          title="Auth Flow Diagram"
          description="Add a diagram here that shows API key usage on the server, access-token issuance from your backend, and ArcenPayProvider consuming the token in the browser."
          heightClassName="h-64"
        />

        <h2 id="guidelines">Usage guidelines</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Store <code>ARCENPAY_API_KEY</code> only in trusted server-side infrastructure.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Mint short-lived access tokens close to where your app resolves the current company or user identity.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Rotate API keys if they are exposed or no longer needed.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Do not build the browser flow around publishable or permanent credentials.</li>
        </ul>

        <h2 id="errors">Authentication errors</h2>
        <CodeBlock
          lang="json"
          code={`{
  "error": "Invalid or revoked API key"
}`}
        />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#auth">Authentication</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#api-key">API key</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#access-token">Access token</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#guidelines">Guidelines</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#errors">Errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
