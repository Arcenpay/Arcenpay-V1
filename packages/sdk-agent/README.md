# @arcenpay/agent

> ArcenPay AI Agent SDK — autonomous x402 payments for AI agents and automated bots.

Give your AI agent a wallet. Let it pay for API access automatically using USDC on-chain — no human approval required.

## Installation

```bash
npm install @arcenpay/agent @arcenpay/sdk viem
```

## Quick Start

```typescript
import { ArcenPayAgent } from "@arcenpay/agent";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,   // Agent's wallet private key
  rpcUrl: process.env.RPC_URL!,                  // e.g. https://sepolia.base.org
  chainId: 84532,                                // Base Sepolia
  maxAutoApprove: "1.00",                        // Max USDC per request (default: "0.01")
});

console.log("Agent wallet:", agent.address);

// Pre-fund a session with USDC
const sessionId = await agent.fundSession("10.00");  // $10 USDC
console.log("Session:", sessionId);

// Make API calls that automatically handle x402 payment
const response = await agent.fetch("https://api.yourprovider.com/v1/data", {
  method: "GET",
  autoApprove: true,    // Auto-pay if x402 response received
  maxPrice: "0.01",     // Max $0.01 USDC for this request
});

const data = await response.json();
```

## How It Works

```
1. Agent calls fetch("https://api.provider.com/endpoint")
2. Provider returns HTTP 402 with x402 payment options
3. ArcenPayAgent reads the payment options
4. If autoApprove=true and price ≤ maxPrice:
   a. Signs EIP-712 payment message
   b. Retries the request with X-PAYMENT header
5. Provider validates payment via x402Middleware
6. USDC settled from SessionVault to provider
```

## API Reference

### `new ArcenPayAgent(config)`

```typescript
const agent = new ArcenPayAgent({
  privateKey: "0x...",      // Required — agent wallet private key
  rpcUrl: "https://...",    // Required — JSON-RPC URL
  chainId: 84532,           // Required — chain ID
  maxAutoApprove: "0.10",   // Optional — max USDC per auto-approve (default: "0.01")
  sessionVaultAddress: "0x...",  // Optional — override SessionVault address
});
```

### `agent.address`

Read-only. Returns the agent's wallet address.

```typescript
console.log(agent.address); // "0x1234..."
```

### `agent.fundSession(amount)`

Deposit USDC into the SessionVault to fund API calls.

```typescript
const sessionId = await agent.fundSession("50.00");  // $50 USDC
// Returns: "0xsessionId..."
```

### `agent.fetch(url, options?)`

Drop-in replacement for `fetch()`. Automatically handles x402 payment.

```typescript
const response = await agent.fetch("https://api.provider.com/analyze", {
  method: "POST",
  body: JSON.stringify({ text: "Hello world" }),
  headers: { "Content-Type": "application/json" },

  // ArcenPay-specific options:
  autoApprove: true,     // Auto-pay (default: true if maxAutoApprove > 0)
  maxPrice: "0.001",     // Max USDC for this specific call
});
```

## Error Handling

```typescript
import { ArcenPayAgent } from "@arcenpay/agent";
import { ArcenPayError } from "@arcenpay/sdk";

try {
  const res = await agent.fetch("https://api.provider.com/data");
} catch (err) {
  if (err instanceof ArcenPayError) {
    if (err.message.includes("No USDC address")) {
      // Fund the session first
      await agent.fundSession("10.00");
    }
    if (err.message.includes("Payment amount too low")) {
      // Increase maxPrice
    }
  }
}
```

## Use with AI Frameworks

### LangChain / LangGraph

```typescript
import { ArcenPayAgent } from "@arcenpay/agent";
import { tool } from "@langchain/core/tools";

const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.RPC_URL!,
  chainId: 84532,
  maxAutoApprove: "0.05",
});

// Create a LangChain tool that uses ArcenPay for payment
const premiumSearchTool = tool(async ({ query }) => {
  const res = await agent.fetch(`https://api.search.com/v1/search?q=${query}`);
  return await res.text();
}, {
  name: "premium_search",
  description: "Search using premium API with automatic USDC payment",
});
```

### OpenAI Agents SDK

```typescript
const agent = new ArcenPayAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  rpcUrl: process.env.RPC_URL!,
  chainId: 84532,
});

// Use agent.fetch as drop-in replacement in tool calls
async function callPremiumAPI(endpoint: string, body: object) {
  const response = await agent.fetch(endpoint, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return response.json();
}
```

## Environment Variables

```bash
AGENT_PRIVATE_KEY=0x...         # Agent wallet private key
RPC_URL=https://sepolia.base.org
# OR for testnet:
RPC_URL=https://sepolia.base.org
```

> **Security**: Never commit `AGENT_PRIVATE_KEY` to git. Use environment variables or a secrets manager.

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
