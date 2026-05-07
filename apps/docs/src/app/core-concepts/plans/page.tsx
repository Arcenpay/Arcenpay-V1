import {
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function PlansPage() {
  return (
    <DocsPage
      eyebrow="Core Concepts"
      title="Plans"
      summary="A plan is your recurring commercial offer in ArcenPay. It defines the customer-facing price and billing cadence, and it anchors the entitlements or product access that become available after subscription activation."
      toc={[
        { href: "#model", label: "Plan model" },
        { href: "#catalog", label: "Catalog setup" },
        { href: "#runtime", label: "Runtime usage" },
      ]}
    >
      <DocsSection id="model" title="What a plan contains">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Customer-facing name and description.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Price and billing interval.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Feature or entitlement mapping for your product.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Published status for new subscriptions.</li>
        </ul>
      </DocsSection>

      <DocsSection id="catalog" title="Where plans are configured">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-0">
          In this codebase, plans are created and published from the dashboard
          catalog. Your app should consume the published plan ids and resolved
          entitlement results instead of reconstructing billing logic locally.
        </p>
      </DocsSection>

      <DocsSection id="runtime" title="How plans are used at runtime">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-0">
          Published plans appear in ArcenEmbed checkout flows, company plan
          changes, server-side subscription activation, and downstream access
          checks through the Node and React SDKs.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
