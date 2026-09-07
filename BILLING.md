# ArcenPay — Platform Billing Setup Guide

End-to-end guide for bootstrapping the ArcenPay platform billing system on Arc testnet,
dogfooding the PRO tier, and integrating with external providers via ArcenEmbed.

> Target audience: ArcenPay platform operators and AI coding agents.

---

## 1. Prerequisites

```bash
docker compose up -d          # PostgreSQL :5433, Redis :6380
npm ci                        # install all workspaces
npm run db:generate           # generate Prisma client
npm run typecheck             # verify all packages
```

Ensure these env vars are set across **all 4 `.env` files** (root, `apps/arcen-backend/`, `apps/arcen-dashboard/`, `apps/facilitator/`):

| Variable | Value |
|----------|-------|
| `DEPLOYER_PRIVATE_KEY` | Private key of `0x38f62CCfD6F771eF9E48e3bb86a3E0413aE5319B` |
| `PLATFORM_BILLING_OPS_PRIVATE_KEY` | Same deployer key |
| `PLATFORM_BILLING_TREASURY_ADDRESS` | `0x38f62CCfD6F771eF9E48e3bb86a3E0413aE5319B` |
| `PLATFORM_BILLING_ACCEPTED_TOKEN` | `0x3600000000000000000000000000000000000000` (Arc USDC) |
| `PLATFORM_BILLING_CHAIN_ID` | `5042002` |
| `CHAIN_ID` | `5042002` |
| `ARC_TESTNET_RPC_URL` | `https://rpc.testnet.arc.network` |

---

## 2. Deploy Contracts to Arc Testnet

```bash
cd packages/contracts
npx hardhat compile
npm run deploy:arc-testnet
```

This deploys all 7 UUPS proxy contracts:
- `PlanFactory`, `FeeCollector`, `SubscriptionRegistry`, `SessionVault`, `ZKUsageVerifier`, `ERC7579AutopayModule`, `MirrorRegistry`

### Update All Address References (12 files)

After deployment, copy new addresses from `packages/contracts/deployments/arcTestnet-latest.json` to:

| # | File | Section |
|---|------|---------|
| 1 | `packages/internal-core/src/addresses.ts` | `5042002` block |
| 2 | `packages/sdk-react/src/internal/core/addresses.ts` | Auto-synced by `sync:core` |
| 3 | `packages/sdk-node/src/internal/core/addresses.ts` | Auto-synced by `sync:core` |
| 4 | `packages/sdk-agent/src/internal/core/addresses.ts` | Auto-synced by `sync:core` |
| 5 | `packages/contracts/deployments/environment-manifest.json` | `5042002.contracts` |
| 6-9 | 4 `.env` files | `ARCENPAY_CONTRACT_5042002_*` |
| 10 | `apps/arcenpay-docs/concepts/chains.mdx` | Contract table |
| 11 | `apps/facilitator/.env.example` | Address comments |

### Authorize Facilitator

The deploy script only wires contract-to-contract roles. The facilitator's EOA needs separate authorization:

```bash
# From packages/contracts:
npx hardhat run scripts/authorize-facilitator-settler.ts --network arcTestnet

# Also needed: FeeCollector.authorizeCollector(facilitatorAddr)
# facilitator address = derived from facilitator PRIVATE_KEY (0x019c30d7415e3A456D9646309e5e42367296fd2F)
```

Ensure these are set:
- `SessionVault.authorizedSettlers(0x019c30...96fd2F)` → `true`
- `FeeCollector.authorizedCollectors(0x019c30...96fd2F)` → `true`

---

## 3. Reset Platform Catalog (DRAFT Plans Only)

This creates the platform provider team, environment, and 3 **DRAFT** catalog plans.
Nothing is published or on-chain yet.

```bash
npx tsx apps/arcen-backend/scripts/reset-platform-catalog.ts --apply
```

Produces:
| Plan | Name | Status | Price |
|------|------|--------|-------|
| FREE | ArcenPay Free Plan | DRAFT | $0 |
| PLUS | ArcenPay Pro Plan | DRAFT | $9.99/mo |
| PRO | ArcenPay Enterprise Plan | DRAFT | $499/mo |

And creates:
- `Team` ("Platform Workspace") with OWNER role for `0x38f62...`
- `WorkspaceEnvironment` ("Arcenpay", Arc Testnet)
- `PlatformBillingAccount` (default)
- `EmbedComponent` ("ArcenPay Platform Billing")
- `CatalogConfig` (livePlanIds, restrictLivePlans, initialPlan, fallbackPlan)

### Publish + Register On-Chain (Manual)

Publish plans from the dashboard or via API:
```
POST /api/v1/catalog/publish  (bulk)
PUT  /api/v1/catalog/plans    (individual, set status=PUBLISHED)
```

Register PLUS and PRO on-chain:
```
POST /api/v1/platform/tier/bootstrap
```

This calls `PlanFactory.createPlan()` for PLUS and PRO, creating on-chain plan IDs.

---

## 4. Dogfood the Platform (Subscribe to PRO)

The ArcenPay platform uses its own billing to manage its subscription tier. This is the "dogfooding" step — proving the system works by being its own customer.

### 4.1 Enroll Workpace

```typescript
import { enrollWorkspaceInPlatformBilling } from "./lib/billing/platform-enrollment.js";

await enrollWorkspaceInPlatformBilling({
  workspaceTeamId: PLATFORM_TEAM_ID,
});
```

This creates:
- `PlatformBillingCustomer` (links workspace to provider)
- `ArcenCompany` (the customer record)
- `SubscriptionState` on FREE plan
- `CatalogConfig` with livePlanIds
- `EmbedComponent` on provider

### 4.2 Activate PRO Tier

```typescript
import { activateTeamPlatformTier } from "./lib/billing/platform-tier-billing.js";

await activateTeamPlatformTier({
  teamId: PLATFORM_TEAM_ID,
  targetTier: "PRO",
  walletAddress: PLATFORM_WALLET,
  paymentAccount: PLATFORM_WALLET,
  txHash: "dogfood-bootstrap",
});
```

This goes through the **full subscription lifecycle**:
1. Ensures `PlatformSubscriptionCompany` exists
2. Creates `Invoice` (PAID, $499 USDC)
3. Records `Payment` (SUBSCRIPTION_ACTIVATION, SUCCEEDED)
4. Creates `SubscriptionState` (ACTIVE, Pro plan)
5. Fires webhook: `platform.tier.activated`
6. Sends invoice receipt email (fire-and-forget)

### 4.3 Complete Tier Assignment

The tier is assigned in two places:
- `Team.platformTier` → `"PRO"` (for tier guard limits)
- `SubscriptionState.catalogPlanId` → Pro plan ID (for embed rendering)

```typescript
await db.team.update({
  where: { id: PLATFORM_TEAM_ID },
  data: { platformTier: "PRO", tierExpiresAt: periodEnd, tierSubscriptionId: subStateId },
});
```

### 4.4 Update Company's Active Plan

The embed renders based on `ArcenCompany.activePlanId` → `CatalogPlan`. After activation:

```sql
UPDATE "ArcenCompany" SET "activePlanId" = '<pro-plan-id>'
WHERE id = (SELECT "companyId" FROM "PlatformBillingCustomer"
            WHERE "workspaceTeamId" = '<platform-team-id>');

UPDATE "SubscriptionState" SET "catalogPlanId" = '<pro-plan-id>',
  metadata = metadata || '{"tier": "PRO"}'
WHERE "companyId" = '<company-id>';
```

### 4.5 Verification Checklist

After dogfooding, verify all these:
- [ ] `Team.platformTier` = `"PRO"`
- [ ] `Team.tierExpiresAt` = 30 days from now
- [ ] `Team.tierSubscriptionId` = subscription state ID
- [ ] `ArcenCompany.activePlanId` = PRO catalog plan ID
- [ ] `SubscriptionState.catalogPlanId` = PRO catalog plan ID
- [ ] `SubscriptionState.metadata.tier` = `"PRO"`
- [ ] Invoice `AP-2026-000001` = PAID, $499 USDC
- [ ] Payment record = SUBSCRIPTION_ACTIVATION, SUCCEEDED
- [ ] Embed shows "ArcenPay Enterprise Plan" (not "Free")
- [ ] Dashboard tier badge shows "Pro"

---

## 5. Provider Integration (External Dapps)

When a new provider wants to integrate ArcenPay subscriptions into their dapp:

### 5.1 Provider Creates API Key

Dashboard → Settings → API Keys → Create. Returns `api_xxxxx` (shown once).

### 5.2 Provider Installs SDK

```bash
npm install @arcenpay/react @arcenpay/node
```

### 5.3 Provider Wraps Dapp in ArcenPayProvider

```tsx
import { ArcenPayProvider } from "@arcenpay/react";

function App() {
  return (
    <ArcenPayProvider
      publishableKey="api_xxxxx"        // from dashboard
      componentId="cmp_abc123"          // from dashboard
    >
      <YourRoutes />
    </ArcenPayProvider>
  );
}
```

### 5.4 Provider Identifies End-User Customers

```tsx
const { identify } = useArcenPay();

identify({
  company: { id: "company_123", wallet: "0x...", email: "hi@acme.com" },
  user:    { id: "user_1", wallet: "0x..." }
});
```

This auto-creates the company, assigns the initial plan, and issues a short-lived **embed access token** (JWT, 1hr expiry).

### 5.5 Provider Renders Billing UI

```tsx
<ArcenEmbed />
// or with explicit token:
<ArcenEmbed accessToken={token} componentId="cmp_abc123" />
```

The embed renders a full self-service portal: plan browsing, checkout, wallet payment, invoices, usage meters, subscription management.

### 5.6 Provider Gates Features Server-Side

```typescript
import { ArcenClient } from "@arcenpay/node";

const client = new ArcenClient({ apiKey: "api_xxxxx" });

const flag = await client.checkFlag("pro-analytics", { id: "company_123" });
if (!flag.enabled) throw new Error("Upgrade required");

const usage = await client.consumeEntitlement({
  featureKey: "api-calls",
  company: { id: "company_123" },
  idempotencyKey: `call-${requestId}`,
});
```

### 5.7 Provider Handles Webhooks

```typescript
import { verifyWebhookSignature } from "@arcenpay/node";

app.post("/webhooks/arcenpay", async (req) => {
  const sig = req.headers.get("x-arcenpay-signature") ?? "";
  if (!verifyWebhookSignature(req.body, sig, process.env.ARCENPAY_WEBHOOK_SECRET!))
    return res.status(403).send("Invalid signature");

  const event = JSON.parse(req.body);
  // Handle: subscription.activated, subscription.renewed,
  //         payment.succeeded, payment.failed, company.created
});
```

---

## 6. Auth Architecture

```
┌──────────────────────────────────────────────────────────┐
│ PROVIDER INTEGRATION                                      │
│                                                          │
│ publishableKey (api_xxx)                                  │
│   → POST /access-tokens  (Bearer api_xxx)                │
│     → identifies company + user                          │
│     → returns embed access token (JWT, 1hr)              │
│       → <ArcenEmbed accessToken={token}>                 │
│         → GET /components/:id/render  (Bearer <token>)   │
│           → returns full ComponentRenderData             │
│                                                          │
│ All subsequent embed calls use the short-lived JWT,       │
│ never the raw API key.                                    │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ PLATFORM DOGFOODING (Dashboard Self-Serve)                │
│                                                          │
│ Dashboard session cookie → POST /platform/billing/embed  │
│   → issuePlatformBillingEmbedToken()                     │
│     → JWT scoped to (providerTeamId, companyId)          │
│       → <ArcenEmbed accessToken={token}>                 │
│         → renders ArcenPay's own subscription portal     │
└──────────────────────────────────────────────────────────┘
```

---

## 7. Tier Feature Matrix

| Feature | FREE | PLUS | PRO |
|---------|------|------|-----|
| Dapps linked | 1 | 10 | Unlimited |
| Plans | 3 | 15 | Unlimited |
| Environments | 2 dev + 2 prod | 10 dev + 10 prod | Unlimited |
| Team members | 3 | 10 | Unlimited |
| Feature flags | 5 | 999 | Unlimited |
| Add-ons | 0 | 10 | Unlimited |
| Credit types | 0 | 5 | Unlimited |
| Coupons | 0 | 10 | Unlimited |
| Custom branding | No | Yes | Yes (whitelabel) |
| Cross-chain billing | No | Yes | Yes |
| Agent payments (x402) | Yes | Yes | Yes |
| ZK settlement (ZKVUB) | Yes | Yes | Yes |
| Platform fee | 2.0% | 1.0% | 0.5% |
| Gas sponsorship | No | Yes | Yes |
| Support | Community | Priority email | Dedicated |

---

## 8. Idempotency Conventions

Every billing mutation carries an idempotency key. Follow these patterns:

| Operation | Key Format |
|-----------|------------|
| Billing event | `payment:{event.idempotencyKey}` |
| Subscription activation | `subscription.activate:{txHash}` |
| Plan change | `plan:.change:{changeRequestId}` |
| Credit grant | `grant:{planId}:{companyId}:{periodStart}` |
| Platform tier | `platform.tier.activate:{teamId}:{tier}:{paymentAccount}:{txHash}` |
| Platform renewal | `platform.tier.renew:{teamId}:{tier}:{date}` |

---

## 9. Common Pitfalls

1. **Embed shows FREE after PRO activation** — The `ArcenCompany.activePlanId` and `SubscriptionState.catalogPlanId` must both point to the PRO plan. Activation creates a new state but the embed reads from the existing company record.

2. **Facilitator settlement fails** — Authorize the facilitator EOA on both `SessionVault.authorizeSettler()` and `FeeCollector.authorizeCollector()`. Deploy script only wires contract-to-contract roles.

3. **RPC rate limiting** — Arc public RPC throttles `eth_call`. Use Pimlico for user ops and round-robin RPC fallback for reads.

4. **Plan not found on-chain** — Ensure `ARCENPAY_CONTRACT_5042002_planFactory` matches the actual deployed PlanFactory across ALL config files. One stale env var breaks everything.

5. **Amounts are in micros** — 1 USDC = 1,000,000 micros. Plan prices are stored as decimal USDC in DB and converted to micros for on-chain calls.
