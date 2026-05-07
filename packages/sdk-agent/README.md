# @arcenpay/agent

ArcenPay agent SDK for autonomous x402-style payments by bots, workers, MCP tools, and other non-interactive software buyers.

## Install

```bash
npm install @arcenpay/agent
```

## Quick start

```ts
import { ArcenPayAgent, FileStore } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.RPC_URL!,
  chainId: 84532,
  maxAutoApprove: "0.02",
  store: new FileStore("/tmp/arcenpay-agent-state.json"),
});

await agent.restore();

const sessionId = await agent.fundSession("10.00");
console.log(sessionId);

const response = await agent.fetch("https://api.yourprovider.com/v1/data", {
  method: "GET",
  autoApprove: true,
  maxPrice: "0.01",
});

const data = await response.json();
```

## Main capabilities

- `fundSession(amount)`
- `fetch(url, options)`
- `getUsageReport()`
- `topUpSession(sessionId, amount)`
- `sendDispatchRequest(amount, reason)`
- `restore()`
- `address`
- `currentSessionId`

## Flow

1. Create or restore the agent state.
2. Fund a session vault balance in USDC.
3. Call `agent.fetch()` against a protected resource.
4. If the resource responds with HTTP 402 and the request is within policy, the SDK signs and retries automatically.
5. Inspect usage or top up the session as needed.

## Guardrails

- Keep `maxAutoApprove` conservative.
- Use `maxPrice` for per-request limits.
- Persist state so restarts do not lose nonce or session context.
- Add human approval or dispatch controls for larger top-ups.

## Environment variables

```bash
AGENT_PRIVATE_KEY=0x...
RPC_URL=https://sepolia.base.org
```

Never commit `AGENT_PRIVATE_KEY`.
