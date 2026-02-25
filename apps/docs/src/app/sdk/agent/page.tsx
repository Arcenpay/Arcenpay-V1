// ============================================================
//  Documentation — @meap/agent SDK Reference
//  PRD Section 5.3: AI Agent SDK
// ============================================================

export default function AgentSDKPage() {
  return (
    <>
      <h1>@meap/agent</h1>
      <p>Minimal SDK for AI agent runtimes. Drop-in <code>fetch()</code> replacement with automatic x402 payment negotiation.</p>

      <pre><code>npm install @meap/agent</code></pre>

      <div className="callout info">
        Designed for embedding in agent frameworks: LangChain, AutoGen, CrewAI, and custom runtimes.
      </div>

      <h2>Quick Start</h2>
      <pre><code>{`import { MEAPAgent } from '@meap/agent';

const agent = new MEAPAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  chainId: 11155111,
  maxAutoApprove: '0.01',  // Max USDC per auto-approved payment
});

// Fund a session vault
await agent.fundSession('10', '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');

// Use like fetch() — x402 payments happen automatically
const response = await agent.fetch('https://api.example.com/premium/data');
const data = await response.json();`}</code></pre>

      <h2>Core Methods</h2>

      <h3>agent.fundSession(amount, token)</h3>
      <p>Pre-funds a ZKVUB session vault with stablecoins from the agent's smart account.</p>
      <pre><code>{`const sessionId = await agent.fundSession('10', USDC_ADDRESS);
// Returns: "session_1709123456789"`}</code></pre>

      <h3>agent.fetch(url, options)</h3>
      <p>Drop-in replacement for <code>fetch()</code>. Handles x402 negotiation:</p>
      <ol>
        <li>Makes initial request to URL</li>
        <li>If 402 received, parses x402 response payload</li>
        <li>Evaluates cost against <code>maxAutoApprove</code></li>
        <li>Constructs and signs X-PAYMENT header</li>
        <li>Resubmits request with payment</li>
      </ol>
      <pre><code>{`const res = await agent.fetch('https://api.example.com/compute', {
  method: 'POST',
  body: JSON.stringify({ input: 'data' }),
  maxPrice: '1000000',  // Max USDC atomic units
  autoApprove: true,
});`}</code></pre>

      <h3>agent.getBalance()</h3>
      <p>Returns current session vault balance.</p>
      <pre><code>{`const balance = await agent.getBalance();
// Returns: 9500000n (9.5 USDC in atomic units)`}</code></pre>

      <h3>agent.getUsageReport(sessionId)</h3>
      <p>Returns aggregated consumption data for a session.</p>
      <pre><code>{`const report = await agent.getUsageReport();
// Returns: {
//   sessionId: "session_...",
//   callCount: 42,
//   totalSpent: 42000n  // 0.042 USDC
// }`}</code></pre>

      <h2>LangChain Integration</h2>
      <pre><code>{`import { MEAPAgent } from '@meap/agent';

// Use in a LangChain tool
const meapAgent = new MEAPAgent({ ... });

const tool = {
  name: 'premium_api',
  description: 'Call a premium API with automatic payment',
  func: async (input: string) => {
    const res = await meapAgent.fetch(
      \`https://api.example.com/query?q=\${input}\`
    );
    return await res.text();
  },
};`}</code></pre>
    </>
  );
}
