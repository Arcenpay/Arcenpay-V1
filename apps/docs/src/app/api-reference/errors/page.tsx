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

export default function ApiErrorsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">API Reference</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Error Codes</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="errors">
          ArcenPay uses conventional HTTP response codes to indicate the success or failure of an API request.
        </p>

        <h2 id="http-codes">HTTP Status Codes</h2>
        <table className="docs-table">
          <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td><code>200 - OK</code></td><td>Request succeeded.</td></tr>
            <tr><td><code>400 - Bad Request</code></td><td>The request was unacceptable, often due to missing a required parameter.</td></tr>
            <tr><td><code>401 - Unauthorized</code></td><td>No valid API key provided.</td></tr>
            <tr><td><code>402 - Request Failed</code></td><td>The parameters were valid but the request failed (e.g. low account balance).</td></tr>
            <tr><td><code>404 - Not Found</code></td><td>The requested resource doesn&apos;t exist.</td></tr>
            <tr><td><code>500 - Server Errors</code></td><td>Something went wrong on ArcenPay&apos;s end.</td></tr>
          </tbody>
        </table>

        <h2 id="error-objects">The Error Object</h2>
        <CodeBlock lang="json" code={`{
  "error": {
    "type": "invalid_request_error",
    "code": "resource_missing",
    "message": "No such plan: plan_123",
    "param": "id"
  }
}`} />

        <h2 id="code-list">Specific Error Codes</h2>
        <table className="docs-table">
          <thead><tr><th>Code</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>api_key_invalid</code></td><td>The API key provided is not valid.</td></tr>
            <tr><td><code>insufficient_funds</code></td><td>The user does not have enough tokens to complete the operation.</td></tr>
            <tr><td><code>parameter_missing</code></td><td>A required parameter was not provided.</td></tr>
            <tr><td><code>plan_inactive</code></td><td>The plan is no longer accepting new subscribers.</td></tr>
            <tr><td><code>signature_verification_failed</code></td><td>The webhook signature is invalid.</td></tr>
            <tr><td><code>rate_limit_exceeded</code></td><td>Too many requests hit the API in too short a time.</td></tr>
          </tbody>
        </table>

        <h2 id="handling-errors">Handling errors</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">Wrap SDK calls in <code>try/catch</code>. The <code>ArcenApiError</code> exposes <code>message</code> and <code>statusCode</code> for context.</p>
        <CodeBlock lang="typescript" code={`import { ArcenApiError } from '@arcenpay/node';

try {
  const result = await client.checkEntitlement('analytics_export');
} catch (err) {
  if (err instanceof ArcenApiError) {
    console.error(\`API error \${err.statusCode}: \${err.message}\`);
  }
}`} />

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">💡</span>
          <div>
            We recommend logging the <code>id</code> of every error response when contacting support.
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#errors">Error Codes</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#http-codes">HTTP Codes</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#error-objects">Error Object</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#code-list">Specific codes</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#handling-errors">Handling errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
