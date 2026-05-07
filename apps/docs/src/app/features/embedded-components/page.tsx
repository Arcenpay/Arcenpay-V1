import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function EmbeddedComponentsPage() {
  return (
    <DocsPage
      eyebrow="Features"
      title="Embedded components"
      summary="Embedded components are the fastest way to ship a branded billing center inside your product. You publish the layout and billing blocks from the dashboard and render the result with ArcenEmbed."
      toc={[
        { href: "#dashboard", label: "Dashboard setup" },
        { href: "#runtime", label: "Runtime flow" },
        { href: "#render", label: "Render the component" },
        { href: "#token", label: "Optional token path" },
      ]}
    >
      <DocsSection id="dashboard" title="What you configure in the dashboard">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Which billing sections are visible.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Design tokens, spacing, copy, and layout.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Plan selection, payment actions, invoices, usage blocks, and
            self-serve account flows.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The published component id that your app will render.
          </li>
        </ul>
      </DocsSection>

      <DocsSection id="runtime" title="Runtime flow">
        <ol className="pl-5 mb-[18px] space-y-[7px] list-decimal">
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            Your app initializes <code>ArcenPayProvider</code>.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            You identify the current company or user.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            <code>ArcenEmbed</code> resolves the published component plus the
            active billing state for that customer.
          </li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">
            The customer can move through portal, checkout, payment, unsubscribe,
            and success states without a separate modal component.
          </li>
        </ol>
      </DocsSection>

      <DocsSection id="render" title="Render the component">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function BillingSurface() {
  return <ArcenEmbed componentId="cmp_123" mode="modal" />;
}`}
        />
      </DocsSection>

      <DocsSection id="token" title="Optional backend-issued token path">
        <DocsCodeBlock
          lang="tsx"
          code={`import { ArcenEmbed } from "@arcenpay/react";

export function EmbedOnlySurface({ token }: { token: string }) {
  return <ArcenEmbed accessToken={token} componentId="cmp_123" />;
}`}
        />
      </DocsSection>
    </DocsPage>
  );
}
