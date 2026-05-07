import {
  DocsCodeBlock,
  DocsPage,
  DocsSection,
} from "../../_components/DocsPrimitives";

export default function AgentSDKPage() {
  return (
    <DocsPage
      eyebrow="SDK Reference"
      title="Agent SDK"
      summary="Use @arcenpay/agent when software is the buyer: background workers, bots, MCP tools, or autonomous systems that need to negotiate and pay for x402-style protected resources without an interactive browser checkout."
      toc={[
        { href: "#install", label: "Install" },
        { href: "#setup", label: "Setup" },
        { href: "#funding", label: "Fund session" },
        { href: "#fetch", label: "Paid fetch" },
        { href: "#persistence", label: "Persistence" },
        { href: "#controls", label: "Controls" },
      ]}
    >
      <DocsSection id="install" title="Install">
        <DocsCodeBlock lang="bash" code={`npm install @arcenpay/agent`} />
      </DocsSection>

      <DocsSection id="setup" title="Initialize the agent">
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

await agent.restore();`}
        />
      </DocsSection>

      <DocsSection id="funding" title="Fund a session">
        <DocsCodeBlock
          lang="ts"
          code={`const sessionId = await agent.fundSession("5");
console.log("Session funded:", sessionId);`}
        />
      </DocsSection>

      <DocsSection id="fetch" title="Make paid requests">
        <DocsCodeBlock
          lang="ts"
          code={`const response = await agent.fetch("https://merchant.example/x402/resource", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: "summarize this invoice" }),
  autoApprove: true,
  maxPrice: "0.01",
});

const data = await response.json();`}
        />
      </DocsSection>

      <DocsSection id="persistence" title="Restore and inspect usage state">
        <DocsCodeBlock
          lang="ts"
          code={`const report = await agent.getUsageReport();

console.log({
  sessionId: report.sessionId,
  callCount: report.callCount,
  totalSpent: report.totalSpent.toString(),
  remainingBalance: report.remainingBalance.toString(),
});`}
        />
      </DocsSection>

      <DocsSection id="controls" title="Top-ups and dispatch controls">
        <DocsCodeBlock
          lang="ts"
          code={`await agent.topUpSession(agent.currentSessionId!, "2");

const requests = await agent.sendDispatchRequest(
  "3",
  "Need more balance for nightly reconciliation",
);`}
        />
      </DocsSection>
    </DocsPage>
  );
}
