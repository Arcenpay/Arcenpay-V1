# @arcenpay/node

ArcenPay Node.js SDK for server-side billing actions, access-token minting, company APIs, entitlement checks, subscription activation, webhook verification, and optional advanced runtime services.

## Install

```bash
npm install @arcenpay/node
```

## Standard server path

Create the client:

```ts
import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({
  apiKey: process.env.ARCENPAY_API_KEY!,
});
```

Mint a short-lived access token:

```ts
const session = await client.identify({
  company: { id: "company_123", wallet: "0xabc..." },
  user: { id: "user_123", wallet: "0xabc..." },
  expiresIn: 3600,
});
```

Check access and consume usage:

```ts
const entitlement = await client.checkEntitlement("scan", {
  id: "company_123",
});
const flag = await client.checkFlag("scan", { id: "company_123" });

const result = await client.consumeEntitlement({
  featureKey: "scan",
  company: { id: "company_123" },
  idempotencyKey: "scan-req-1",
});
```

Activate a subscription:

```ts
const activation = await client.activateSubscription({
  planId: "starter",
  paymentAccount: "0xabc...",
  company: { id: "company_123", wallet: "0xabc..." },
});
```

Verify webhook signatures:

```ts
import { verifyWebhookSignature } from "@arcenpay/node";

const rawBody = await req.text();
const signatureHeader = req.headers.get("x-arcenpay-signature") ?? "";
const signature = signatureHeader.startsWith("sha256=")
  ? signatureHeader.slice("sha256=".length)
  : signatureHeader;

if (
  !verifyWebhookSignature(
    rawBody,
    signature,
    process.env.ARCENPAY_WEBHOOK_SECRET!,
  )
) {
  throw new Error("Invalid webhook signature");
}
```

## Main exports

Standard app integrations usually use:

- `ArcenClient`
- `ArcenApiError`
- `verifyWebhookSignature`

The package also exposes advanced optional services:

- `x402Middleware`
- `WebhookService`
- `UsageService`
- `SettlementService`
- `SettlementWriterService`
- `EventListenerService`
- `BillingKeeper`
- `TablelandService`
- `ProofOrchestrator`
- `AxelarTransport`
- `CCIPTransport`
- `InMemoryNonceStore`
- `RedisNonceStore`

## Environment variables

```bash
ARCENPAY_API_KEY=api_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx
```

The SDK uses a fixed default API URL of `http://localhost:3300`. Change the SDK
constant manually when promoting to production.

## Boundary

Use `@arcenpay/node` for server-owned logic. For customer-facing UI, use
`@arcenpay/react`.
