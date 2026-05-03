import Link from "next/link";

type ManagedSurfacePageProps = {
  breadcrumb: string;
  title: string;
  summary: string;
  related?: Array<{ href: string; label: string }>;
};

export default function ManagedSurfacePage({
  breadcrumb,
  title,
  summary,
  related = [
    { href: "/quickstart", label: "Quickstart" },
    { href: "/sdk-reference", label: "SDK Reference" },
    { href: "/support", label: "Support" },
  ],
}: ManagedSurfacePageProps) {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">
          {breadcrumb}
        </div>
        <div className="flex items-center justify-between gap-4 mb-3.5">
          <h1 className="text-[clamp(30px,4vw,42px)] font-bold tracking-[-0.04em] leading-tight">
            {title}
          </h1>
        </div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="overview">
          {summary}
        </p>

        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            ArcenPay manages the underlying chain infrastructure, deployment
            details, and protocol internals for this surface. Public
            integrations should use the dashboard, SDKs, and documented APIs
            instead of depending on low-level implementation details.
          </div>
        </div>

        <h2 id="next-steps" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          What to use instead
        </h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Create and manage billing surfaces from the ArcenPay dashboard.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use the React and Node SDKs for checkout, billing, and access checks.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use webhooks to keep your app in sync with subscription, invoice, and payment events.</li>
        </ul>

        <h2 id="related" className="text-2xl font-bold tracking-[-0.03em] mt-[42px] mb-3.5">
          Related docs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
          {related.map((item) => (
            <Link key={item.href} href={item.href} className="block border border-border bg-card rounded-2xl p-[18px] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-lg hover:shadow-black/5">
              <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-1.5">
                Public docs
              </div>
              <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-1.5">{item.label}</h3>
              <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                Continue with the supported integration path for this area.
              </p>
              <span className="inline-flex items-center gap-1.5 mt-2.5 text-xs font-bold text-foreground">
                Open guide →
              </span>
            </Link>
          ))}
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">
          On this page
        </div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a href="#overview" className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground">Overview</a></li>
          <li className="toc-item"><a href="#next-steps" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">What to use instead</a></li>
          <li className="toc-item"><a href="#related" className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors">Related docs</a></li>
        </ul>
      </nav>
    </div>
  );
}
