export default function AIAgentPaymentsGuidePage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Guides</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>AI Agent Payments</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="ai-agent-payments">
          Use ArcenPay&apos;s agent SDK when software is the buyer: internal
          automation, background workers, MCP tools, or autonomous agents that
          need to pay for x402-protected resources.
        </p>

        <h2 id="flow">Recommended flow</h2>
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Create an agent wallet with a clear spending policy.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Instantiate <code>MEAPAgent</code> with a persistent store so session state survives restarts.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Fund a session vault in USDC before making paid requests.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use <code>agent.fetch()</code> against resources that return HTTP 402 when payment is required.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Monitor usage reports and add top-up or dispatch controls for larger workloads.</li>
        </ol>

        <h2 id="guards">Guardrails</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Set <code>maxAutoApprove</code> conservatively for autonomous runs.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use <code>maxPrice</code> per request when the upstream service can vary by endpoint.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Persist session and nonce state to avoid duplicate or invalid signed requests.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Layer dispatch approval if a human should approve larger top-ups.</li>
        </ul>

        <h2 id="when-to-use">When to use it</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Choose the agent SDK when your integration acts on its own and cannot
          rely on an interactive browser checkout. For user-facing SaaS billing,
          the React and Node SDKs remain the better fit.
        </p>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#ai-agent-payments">AI Agent Payments</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#flow">Recommended flow</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#guards">Guardrails</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#when-to-use">When to use it</a></li>
        </ul>
      </nav>
    </div>
  );
}
