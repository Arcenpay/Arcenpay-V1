# @arcenpay/node

> ArcenPay Node.js SDK — backend services, x402 payment middleware, and billing automation.

Use this in your Express/Fastify/Next.js API routes to gate endpoints with on-chain payment, track usage, and automate billing settlement.

## Installation

```bash
npm install @arcenpay/node @arcenpay/sdk viem
```

## Quick Start

### Gate an API endpoint with x402

```typescript
import express from "express";
import { x402Middleware } from "@arcenpay/node";

const app = express();

// Any request to /api/premium must have a valid x402 payment header
app.use("/api/premium", x402Middleware({
  planId: "1",                  // The plan ID from PlanFactory
  ratePerCall: "0.001",         // Human-readable USDC amount per request
  chainId: 84532,               // Base Sepolia
}));

app.get("/api/premium/data", (req, res) => {
  // req.meapPayment.verified — payment is verified
  // req.meapPayment.signer  — customer's wallet address
  res.json({ data: "premium content" });
});
```

### Track usage events

```typescript
import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
  baseUrl: process.env.ARCENPAY_BASE_URL!,
});

await client.identify({
  company: { id: "company_123" },
  user: { id: "user_456" },
});

// Analytics event
await client.track("export_triggered");

// Metered entitlement enforcement
const result = await client.consumeEntitlement({
  featureKey: "scan",
  idempotencyKey: "scan-req-1",
});

if (!result.consumed) {
  throw new Error(result.reason);
}
```

### Automate billing with BillingKeeper

```typescript
import { BillingKeeper } from "@arcenpay/node";

const keeper = new BillingKeeper({
  rpcUrl: process.env.RPC_URL!,
  privateKey: process.env.FACILITATOR_PRIVATE_KEY!,   // Pays gas
  chainId: 84532,
  contracts: {
    subscriptionRegistry: "0x...",
    autopayModule: "0x...",
  },
  intervalMs: 60_000,   // Check every minute
});

keeper.start();
// Automatically calls autopayModule.execute() for due subscriptions
```

### Cross-chain subscription mirroring

```typescript
import { AxelarTransport, CCIPTransport } from "@arcenpay/node";

// Primary: Axelar GMP
const axelar = new AxelarTransport({
  environment: "testnet",
  sourceChainId: 11155111,
});

// Fallback: Chainlink CCIP
const ccip = new CCIPTransport({
  rpcUrl: process.env.RPC_URL!,
  routerAddress: "0x...",
});

// Mirror subscription event to Base Sepolia
await axelar.dispatch({
  destinationChain: "base-sepolia",
  destinationAddress: "0xMirrorRegistry",
  payload: encodedSubscriptionData,
  fallback: ccip,
});
```

### Deliver webhooks

```typescript
import { WebhookService } from "@arcenpay/node";

const webhooks = new WebhookService({
  secret: process.env.WEBHOOK_SECRET!,
  maxRetries: 5,
  // Exponential backoff: 1s, 5s, 30s, 5m, 30m
});

await webhooks.deliver({
  url: "https://customer-app.com/webhooks",
  event: "subscription.renewed",
  payload: {
    subscriber: "0x...",
    planId: 1,
    expiresAt: 1234567890,
  },
});
```

### Send transactional email

```typescript
import { EmailService } from "@arcenpay/node";

const email = new EmailService({
  apiKey: process.env.RESEND_API_KEY!,
  from: "billing@yourapp.com",
});

await email.sendInvoice({
  to: "customer@example.com",
  invoiceId: "INV-2025-0042",
  planName: "Pro Plan",
  amount: "$50.00 USDC",
  pdfUrl: "https://...",
});
```

### Feature flags via Tableland

```typescript
import { TablelandService } from "@arcenpay/node";

const tableland = new TablelandService({
  tableName: "arcenpay_flags_84532_42",
  chainId: 84532,
  rpcUrl: process.env.RPC_URL!,
  privateKey: process.env.TABLELAND_PRIVATE_KEY!,  // For writes
});

await tableland.initialize();

// Set feature flags for a subscriber
await tableland.setFeatureFlags("0xCustomerWallet", {
  advanced_analytics: true,
  api_calls_limit: 10000,
  webhooks: true,
});

// Get feature flags (used by sdk-react useEntitlement)
const flags = await tableland.getFeatureFlags("0xCustomerWallet");
```

## All Services

| Service | Description |
|---------|-------------|
| `x402Middleware` | Express middleware for HTTP 402 payment gating |
| `UsageService` | ZK proof generation + usage tracking |
| `SettlementService` | On-chain settlement event watcher |
| `SettlementWriterService` | Submit settlement transactions |
| `EventListenerService` | Monitor subscription events on-chain |
| `WebhookService` | HMAC-signed webhook delivery with retry |
| `EmailService` | Transactional email via Resend |
| `TablelandService` | Feature flags CRUD on Tableland |
| `LitProtocolService` | Access control conditions builder |
| `BillingKeeper` | Automated renewal + payment pull cron |
| `ProofOrchestrator` | Orchestrate ZK proof → settlement pipeline |
| `RedisUsageStore` | Redis-backed usage event storage |
| `AxelarTransport` | Axelar GMP cross-chain messaging |
| `CCIPTransport` | Chainlink CCIP cross-chain fallback |
| `InMemoryNonceStore` | In-memory nonce store (dev) |
| `RedisNonceStore` | Redis-backed nonce store (production) |

## Tableland Subpath Import

For serverless or edge environments where you only need Tableland:

```typescript
import { TablelandService } from "@arcenpay/node/tableland";
```

## x402 Request Context

After the middleware runs successfully, the payment context is available on `req.meapPayment`:

```typescript
app.get("/api/premium", (req, res) => {
  const {
    verified,           // true
    signer,             // "0xCustomerWallet"
    planId,             // "1"
    amount,             // "1000" (in token base units)
    sessionId,          // "0x..."
    settlementTxHash,   // "0x..." or null
    timestamp,          // Unix timestamp
  } = req.meapPayment;

  res.json({ ok: true });
});
```

## Environment Variables

```bash
RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
REDIS_URL=redis://localhost:6379
RESEND_API_KEY=re_...
TABLELAND_PRIVATE_KEY=0x...
WEBHOOK_SECRET=your-webhook-secret
```

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
