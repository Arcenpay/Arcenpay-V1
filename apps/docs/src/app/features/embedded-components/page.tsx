export default function EmbeddedComponentsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Features</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Embedded Components</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="embedded-components">
          ArcenPay supports embedded billing surfaces through dashboard-managed
          components, short-lived embed access tokens, and the React SDK&apos;s
          <code>ArcenEmbed</code> and <code>TemplateRenderer</code> exports.
        </p>

        <h2 id="overview">What is included</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Plan management and subscription switching flows.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Invoice history, next bill due, and payment-method summaries.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Metered feature usage and included entitlement blocks.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Design tokens and template-driven blocks configured from the dashboard.</li>
        </ul>

        <h2 id="tokens">Embed access tokens</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Embedded components use a short-lived signed token that carries the
          team, company, user, and optional component context. The browser
          should receive only this token, never a workspace API key.
        </p>
        <div className="docs-callout-info mb-5">
          <span className="docs-callout-icon">i</span>
          <div>
            The render flow accepts the token in the
            <code>Authorization: Bearer &lt;token&gt;</code> header, and preview
            tokens can be restricted to a single component id.
          </div>
        </div>

        <h2 id="render-flow">Render flow</h2>
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Create the component definition in the dashboard component builder.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Issue a short-lived embed token for the company or user opening the surface.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Render the component in React with <code>ArcenEmbed</code> and the component id.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">The dashboard render API resolves active plan, entitlements, usage, invoices, and payment metadata for that viewer.</li>
        </ol>

        <h2 id="react-sdk">React SDK usage</h2>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`import { ArcenEmbed } from '@arcenpay/react';

<ArcenEmbed
  accessToken={embedToken}
  componentId="cmp_123"
  baseUrl="https://dashboard.arcenpay.xyz"
  initialView="portal"
/>`}</code>
          </pre>
        </div>

        <h2 id="templates">Template renderer</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Use <code>TemplateRenderer</code> when you want a simpler JSON-block
          surface outside the full portal lifecycle.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">tsx</span>
          </div>
          <pre>
            <code>{`import { TemplateRenderer } from '@arcenpay/react';

<TemplateRenderer
  name="growth-plan"
  blocks={[
    { type: 'heading', content: 'Growth' },
    { type: 'text', content: 'Best for teams shipping weekly.' },
    { type: 'price', amount: '$79', interval: '/month' },
    { type: 'feature-list', items: ['Unlimited projects', 'Usage dashboard'] },
    { type: 'cta', content: 'Upgrade now', href: '/billing' },
  ]}
/>`}</code>
          </pre>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#embedded-components">Embedded Components</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#overview">What is included</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#tokens">Embed access tokens</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#render-flow">Render flow</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react-sdk">React SDK usage</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#templates">Template renderer</a></li>
        </ul>
      </nav>
    </div>
  );
}
