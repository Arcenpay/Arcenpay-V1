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
    <div className="docs-body" style={{ width: '100%' }}>
      <article className="docs-article">
        <div className="docs-page-breadcrumb">API Reference</div>
        <div className="docs-page-title-row"><h1>Error Codes</h1></div>

        <p className="docs-lead" id="errors">
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
        <p>In your code, you should switch on the <code>type</code> and <code>code</code> fields to handle different failure states gracefully.</p>
        <CodeBlock lang="typescript" code={`try {
  await client.plans.create({...});
} catch (err) {
  if (err.code === 'insufficient_funds') {
    // Notify user to bridge more USDC
  } else if (err.type === 'invalid_request_error') {
    // Debug your parameters
  }
}`} />

        <div className="docs-callout info">
          <span className="docs-callout-icon">💡</span>
          <div>
            We recommend logging the <code>id</code> of every error response when contacting support.
          </div>
        </div>
      </article>

      <nav className="docs-toc">
        <div className="docs-toc-heading">On this page</div>
        <ul className="docs-toc-list">
          <li className="docs-toc-item active"><a href="#errors">Error Codes</a></li>
          <li className="docs-toc-item"><a href="#http-codes">HTTP Codes</a></li>
          <li className="docs-toc-item"><a href="#error-objects">Error Object</a></li>
          <li className="docs-toc-item"><a href="#code-list">Specific codes</a></li>
          <li className="docs-toc-item"><a href="#handling-errors">Handling errors</a></li>
        </ul>
      </nav>
    </div>
  );
}
