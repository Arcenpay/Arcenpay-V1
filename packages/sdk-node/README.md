# @arcenpay/node

ArcenPay Node.js SDK for public server-side integrations: authenticated API calls, entitlement checks, subscription activation, webhook verification, protocol event helpers, and x402 middleware.

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
- `buildEventIdempotencyKey`
- `createProtocolEvent`
- `x402Middleware`
- `InMemoryNonceStore`
- `RedisNonceStore`

## Environment variables

```bash
ARCENPAY_API_KEY=api_xxxxxxxxx
ARCENPAY_WEBHOOK_SECRET=whsec_xxxxxxxxx
```

The SDK uses `https://api.arcenpay.com` by default. You can override it via
`baseUrl` in the `ArcenClient` configuration if needed.

## Boundary

Use `@arcenpay/node` for developer-facing server integrations. ArcenPay-operated
runtime services such as proof submission, settlement, keepers, and webhook
delivery live in the internal apps, not in this public SDK. For customer-facing
UI, use `@arcenpay/react`.
