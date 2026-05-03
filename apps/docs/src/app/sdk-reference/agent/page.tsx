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

export default function AgentSDKPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">SDK Reference</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Agent SDK</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="agent-sdk">
          <code>@arcenpay/agent</code> is the public client for autonomous,
          x402-compatible payments. It manages session funding, paid requests,
          auto-topups, and persisted nonce/session state for agentic workflows.
        </p>

        <h2 id="installation">Installation</h2>
        <CodeBlock lang="bash" code={`npm install @arcenpay/agent`} />

        <h2 id="setup">Initialize the agent</h2>
        <CodeBlock
          lang="ts"
          code={`import { MEAPAgent, FileStore } from '@arcenpay/agent';

const agent = new MEAPAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.BASE_RPC_URL!,
  chainId: 84532,
  maxAutoApprove: '0.02',
  store: new FileStore('/tmp/arcenpay-agent-state.json'),
});

await agent.restore();`}
        />

        <h2 id="funding">Fund a session</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Before an agent can settle paid requests, it needs a funded session in
          the ArcenPay session vault. The SDK approves USDC, funds the vault,
          and persists the returned session id for reuse.
        </p>
        <CodeBlock
          lang="ts"
          code={`const sessionId = await agent.fundSession('5');
console.log('Session funded:', sessionId);`}
        />

        <h2 id="paid-fetch">Make paid requests</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use <code>agent.fetch()</code> as a drop-in replacement for
          <code>fetch</code>. When the upstream server responds with HTTP 402,
          the SDK negotiates the payment, signs the x402 header, and retries.
        </p>
        <CodeBlock
          lang="ts"
          code={`const response = await agent.fetch(
  'https://merchant.example/x402/resource',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'summarize this invoice' }),
    autoApprove: true,
    maxPrice: '0.01',
  }
);`}
        />

        <h2 id="persistence">Persistence and usage</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Persisting state prevents nonce reuse across restarts and keeps agent
          spending/accounting consistent across long-running jobs.
        </p>
        <CodeBlock
          lang="ts"
          code={`const report = await agent.getUsageReport();

console.log({
  sessionId: report.sessionId,
  callCount: report.callCount,
  totalSpent: report.totalSpent.toString(),
  remainingBalance: report.remainingBalance.toString(),
});`}
        />

        <h2 id="topups">Top-ups and dispatch</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          When you need tighter controls, configure dispatch providers or manual
          top-up flows instead of allowing unbounded auto-approval.
        </p>
        <CodeBlock
          lang="ts"
          code={`await agent.topUpSession(agent.currentSessionId!, '2');

const requests = await agent.sendDispatchRequest(
  '3',
  'Need more balance for nightly reconciliation'
);`}
        />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#agent-sdk">Agent SDK</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#installation">Installation</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#setup">Initialize</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#funding">Fund a session</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#paid-fetch">Paid fetch</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#persistence">Persistence</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#topups">Top-ups</a></li>
        </ul>
      </nav>
    </div>
  );
}
