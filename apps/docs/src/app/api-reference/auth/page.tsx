'use client';

import { useState } from 'react';

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
          Authenticate server-to-server requests with your ArcenPay API key.
          Keep the key on trusted backend infrastructure only and mint
          short-lived customer access tokens when the browser needs ArcenPay context.
        </p>

        <h2 id="header">Authorization header</h2>
        <CodeBlock
          lang="bash"
          code={`curl "https://dashboard.arcenpay.xyz/api/v1/check?companyId=company_123&featureKey=priority_support" \\
  -H "Authorization: Bearer api_xxxxxxxxxxxxxxxxx"`}
        />

        <h2 id="guidelines">Usage guidelines</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Send your API key with the <code>Authorization: Bearer</code> header.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Store the key in a secure server-side environment variable.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Rotate keys if you suspect exposure or no longer need an integration.</li>
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
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#header">Authorization header</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#guidelines">Guidelines</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#errors">Errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
