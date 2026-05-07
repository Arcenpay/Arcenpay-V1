import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function AIAgentPaymentsGuidePage() {
  return (
    <DocsPage
      eyebrow="Guides"
      title="AI agent payments"
      summary="Use the agent SDK when software is the buyer: automation, bots, background workers, or MCP tools that need to pay for x402-style protected resources without a browser checkout."
      toc={[
        { href: "#flow", label: "Flow" },
        { href: "#guardrails", label: "Guardrails" },
        { href: "#when", label: "When to use it" },
      ]}
    >
      <DocsSection id="flow" title="Recommended flow">
        <DocsCodeBlock
          lang="ts"
          code={`import { ArcenPayAgent, FileStore } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.BASE_RPC_URL!,
  chainId: 84532,
  maxAutoApprove: "0.02",
  store: new FileStore("/tmp/arcenpay-agent-state.json"),
});

await agent.restore();
await agent.fundSession("5");

const response = await agent.fetch("https://merchant.example/x402/resource", {
  autoApprove: true,
  maxPrice: "0.01",
});`}
        />
      </DocsSection>

      <DocsSection id="guardrails" title="Guardrails">
        <ul className="pl-5 mb-[18px] space-y-[7px]">
          <li className="text-[15px] text-muted-foreground leading-relaxed">Set <code>maxAutoApprove</code> conservatively.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Use <code>maxPrice</code> per request when resource pricing differs by endpoint.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Persist session and nonce state so restarts do not create invalid or duplicate signed requests.</li>
          <li className="text-[15px] text-muted-foreground leading-relaxed">Layer dispatch approval if a human should approve larger top-ups.</li>
        </ul>
      </DocsSection>

      <DocsSection id="when" title="When to use it">
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-0">
          Choose the agent SDK when your integration acts on its own and cannot
          rely on an interactive browser flow. For user-facing SaaS billing, the
          React and Node SDKs remain the better fit.
        </p>
      </DocsSection>
    </DocsPage>
  );
}
