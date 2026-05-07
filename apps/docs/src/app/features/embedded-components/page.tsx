import DocImagePlaceholder from "../../_components/DocImagePlaceholder";

export default function EmbeddedComponentsPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Features</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Embedded Components</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="embedded-components">
          Embedded components are the fastest way to ship a branded billing
          center inside your app. You configure the experience in the dashboard,
          issue a short-lived access token on your backend, and render the
          component with <code>ArcenEmbed</code>.
        </p>

        <h2 id="what-you-configure">What you configure in the dashboard</h2>
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Which billing blocks appear in the portal</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Layout, design tokens, and branded copy</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Plan switching, invoice history, payment method, and usage sections</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">The component id your app will render</li>
        </ul>

        <DocImagePlaceholder
          title="Component Builder Screenshot"
          description="Add a screenshot here of the dashboard component builder showing sections, design controls, and the published component id."
          heightClassName="h-80"
        />

        <h2 id="token-flow">Embed access-token flow</h2>
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Your backend identifies the current company or user with the Node SDK.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">The backend returns a short-lived access token to the browser.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Your React app renders ArcenEmbed with that token and the dashboard component id.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">ArcenPay resolves the customer&apos;s current billing state and renders the surface.</li>
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
  initialView="portal"
/>`}</code>
          </pre>
        </div>

        <DocImagePlaceholder
          title="Published Portal in App Context"
          description="Add a screenshot here of the final embedded customer portal running inside your real product UI."
          heightClassName="h-80"
        />
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#embedded-components">Embedded Components</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#what-you-configure">Dashboard setup</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#token-flow">Token flow</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#react-sdk">React SDK</a></li>
        </ul>
      </nav>
    </div>
  );
}
