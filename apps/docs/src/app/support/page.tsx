export default function SupportPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Resources</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Support</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]">
          Use this page when you need help launching or operating public ArcenPay
          billing surfaces such as subscriptions, hosted payment links, invoices,
          and customer access checks.
        </p>

        <h2 id="scope">Supported scope</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Primary chain: Base Sepolia (84532).</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Recurring subscription checkout and subscription lifecycle help.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Hosted one-time payment links and invoice collection help.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">SDK setup, webhook verification, and dashboard configuration help.</li>
        </ul>

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            If you are unsure whether an issue is in your app or in ArcenPay,
            start by sharing the payment link slug, invoice number, webhook event id,
            or affected wallet address with support.
          </div>
        </div>

        <h2 id="channels">Support channels</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
          <div className="border border-border bg-card rounded-2xl p-[18px] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg hover:shadow-black/5">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-1.5">Implementation</div>
            <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-1.5">Integration help</h3>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
              Get help with SDK setup, checkout wiring, hosted payment links, and webhook configuration.
            </p>
            <a href="mailto:support@arcenpay.com" className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-bold text-foreground">
              Contact support →
            </a>
          </div>
          <div className="border border-border bg-card rounded-2xl p-[18px] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg hover:shadow-black/5">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-1.5">Operations</div>
            <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-1.5">Billing troubleshooting</h3>
            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
              Reach out for payment confirmation issues, invoice delivery issues, or customer billing questions.
            </p>
            <a href="/webhooks" className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-bold text-foreground">
              Review webhook flow →
            </a>
          </div>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#scope">Supported scope</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#channels">Support channels</a></li>
        </ul>
      </nav>
    </div>
  );
}
