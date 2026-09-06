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

- `fetch(url, options)` — Autonomous x402 payment negotiation (signs vouchers, handles HTTP 402, auto-retries)
- `resolvePaymentLink(urlOrSlug)` — Discovers and inspects payment link specs without spending funds
- `payPaymentLink(urlOrSlug, options)` — Autonomous checkout with budget verification and on-chain token transfer
- `createPaymentLink(params)` — Programmatically creates payment links for autonomous AI merchants
- `getSpendSummary()` — Real-time budget monitoring (daily spent, total spent, remaining limits)
- `fundSession(amount)` — Pre-funds an on-chain SessionVault with USDC / USDT
- `topUpSession(sessionId, amount)` — Adds funds to an active session
- `ensureBalance()` — Checks threshold and performs auto-top-up if balance is low
- `sendDispatchRequest(amount, reason)` — Dispatches human approval requests (Telegram, Discord, Slack)
- `createArcenAgentMcpTools(agent)` — Model Context Protocol (MCP) tool suite for Claude Desktop & Cursor
- `restore()` — Rehydrates session, nonce, and spend ledger from persistent storage

## Supported Networks

- **Base Mainnet & Base Sepolia** (`8453`, `84532`)
- **BOT Chain Mainnet & BOT Chain Testnet (Bohr)** (`677`, `968`)
- **Arc Testnet** (`5042002`)
- **Ethereum Sepolia** (`11155111`)
- **Stellar Mainnet & Testnet** (`1402`, `1403`)

## Full Documentation

For the comprehensive architectural guide, protocol specifications, MCP server setups, and production checklists, see [ARCEN_AGENT.md](../../ARCEN_AGENT.md).

## Guardrails

- Keep `maxAutoApprove` conservative (e.g. `"0.01"`).
- Use `maxPrice` for per-request limits.
- Set `maxDailySpend` to cap 24-hour total expenditures.
- Persist state (`FileStore`) so restarts do not lose nonce or session context.
- Add human approval or dispatch controls for larger top-ups.

## Environment variables

```bash
AGENT_PRIVATE_KEY=0x...
RPC_URL=https://mainnet.base.org
# Optional for agent merchants
ARCENPAY_API_KEY=api_...
```

Never commit `AGENT_PRIVATE_KEY`.

