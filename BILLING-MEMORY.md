# ArcenPay — Platform Billing Memory

> **Last updated:** 2026-07-26
> **Maintainer:** Platform team
> **Purpose:** Single source of truth for the platform's dogfooded billing system.

---

## Architecture Overview

ArcenPay bills **itself** (dogfooding) using the same SDK and billing infrastructure it sells to customers. The platform billing sits on top of the regular subscription system — every ArcenPay team is also a `Company` with a `SubscriptionState` linked to a `CatalogPlan`.

```
Dashboard (React)
  └─ BillingSection (billing.tsx)
       ├─ Current Plan Summary (usage meters)
       ├─ Gas Budget Widget
       └─ ArcenEmbed SDK (modal mode)
            ├─ planManager   (current plan details)
            ├─ plansTable    (tier comparison cards)
            └─ invoices      (billing history)
                 │
                 ▼
Backend API (Hono)
  ├─ POST /api/v1/platform/billing/embed-token   → generates embed access token
  ├─ GET  /api/v1/platform/tier                  → returns tier info + limits + features
  ├─ POST /api/v1/platform/tier/prepare          → encodes on-chain upgrade txs
  ├─ POST /api/v1/platform/tier/confirm          → verifies tx, activates tier
  ├─ POST /api/v1/platform/tier/bootstrap        → deploys plans on-chain
  ├─ GET  /api/v1/platform/gas-budget            → gas budget widget data
  └─ GET  /api/v1/platform/invoices              → platform subscription invoices
                 │
                 ▼
Billing Engine (lib/billing/)
  ├─ platform-tier-billing.ts   → tier activation, renewal, cancellation, catalog plans
  ├─ billing-ledger.ts          → recordSuccessfulPayment, upsertSubscriptionLedgerState
  └─ platform-billing-customer.ts → first-party customer mapping
```

---

## Tier Definitions

### Pricing (`tier-guard.ts` → `TIER_PRICING`)

| Tier | Monthly | Annual (20% off) |
|------|---------|-------------------|
| FREE | $0 | $0 |
| PLUS | $9.99 | $95 ($7.99/mo) |
| PRO  | $499  | $4,788 ($399/mo) |

### Limits (`tier-guard.ts` → `DEFAULT_LIMITS`)

| Resource | FREE | PLUS | PRO |
|----------|------|------|-----|
| Workspaces | 1 | 10 | 999 |
| Plans | 3 | 15 | 999 |
| Subscribers | 200 | 50,000 | 999,999 |
| Team Members | 3 | 10 | 999 |
| Feature Flags | 5 | 999 | 999 |
| Chains | 1 | 999 | 999 |
| Dev Environments | 2 | 10 | 999 |
| Prod Environments | 2 | 10 | 999 |
| Add-Ons | 0 | 10 | 999,999 |
| Credit Types | 0 | 5 | 999,999 |
| Payment Links | 3 | 50 | 999,999 |
| API Keys | 1 | 999 | 999,999 |
| Webhooks | 1 | 999 | 999,999 |
| Coupons | 0 | 10 | 999,999 |
| Checkout Sessions | 999K | 999K | 999K |
| Platform Fee | 2.0% | 1.0% | 0.5% |
| Gas Budget/Day | $1.00 | $10.00 | $100.00 |

### Feature Display Lists (`platform-tier-billing.ts` → `PLATFORM_TIER_FEATURES`)

Detailed feature strings stored in `CatalogPlan.metadata.entitlements` and synced to `FlagRule` rows:

**FREE** (20 items):1 dapp, 1 webhook, 3 payment links, 1 API key, 3 plans, 200 subs, 1 chain, 2 dev+2 prod envs, 3 members, 5 boolean flags, monthly-only billing, ZKVUB & x402, no add-ons/credits/coupons/usage-metering, no custom branding, community support, 2.0% fee.

**PLUS** (21 items): 10 dapps, unlimited webhooks (per-event), 50 payment links, multiple API keys, 15 plans, 50K subs, unlimited chains, 10 dev+10 prod, 10 members, 999 flags (all types), monthly+annual, ZKVUB & x402, 10 coupons, 10 add-ons, 5 credit types, usage-metering & credit-burn, custom branding, ISO 20022, priority support, 1.0% fee.

**PRO** (21 items): Unlimited dapps/webhooks/payment-links/API keys/plans/subs/chains/envs/members/flags/coupons/add-ons/credit types, usage-metering, full whitelabel, x402, ZKVUB, cross-chain mirroring (Axelar+CCIP), Tableland+Lit Protocol, dedicated support+white-glove onboarding, 0.5% fee.

---

## Access Control — Guard Functions

All gating lives in `lib/catalog/tier-guard.ts`. Each guard checks the team's current tier limits and returns `{ allowed: false, reason, limit, current, upgradeRequired }` if exceeded.

| Guard Function | Route(s) Calling It | What It Blocks |
|---|---|---|
| `assertCanCreatePlan` | `catalog/plans.ts:277` | FREE: max 3 plans |
| `assertCanCreateAddOn` | `catalog/addons.ts:139,228,338` + `addon-entitlements.ts:77` | FREE: 0 (blocked completely) |
| `assertCanCreateCreditType` | `catalog/credits.ts:87,180,302` | FREE: 0 (blocked completely) |
| `assertCanCreateApiKey` | `api-keys.ts:69` | FREE: 1 key per env |
| `assertCanCreatePaymentLink` | `payment-links.ts:89` | FREE: 3 active links |
| `assertCanCreateSubscriber` | `companies.ts:138` | FREE: 200 companies |
| `assertCanInviteMember` | `team/invite.ts:34` | FREE: 3 members |
| `assertCanCreateWebhook` | `provider/webhooks.ts:142` | FREE: 1 webhook; blocks per-event prefs |
| `assertCanCreateWorkspace` | `auth/auth-flow.ts:206` | FREE: 1 workspace |
| `assertCanCreateCheckoutSession` | `checkout-sessions.ts:86` | De facto unlimited (999K) |
| `assertTierFeature` | Various (webhooks, customBranding, support) | Boolean feature checks |
| **Environment chain count** | `environment/index.ts:177` | FREE: 1 distinct chain (inlined check) |

Annual billing is blocked for FREE in `catalog/plans.ts:261-275`.
Usage metering/credit consumption is blocked for FREE in `usage-consume.ts:161`.
Feature flag count + non-boolean types blocked for FREE in `feature-flags.ts:137-153`.
Custom branding blocked for FREE via `TIER_FEATURES.customBranding` in `templates/index.ts:68` and `feature-flags.ts:150`.

---

## Entitlements & Feature Flags

### How Platform Tier Features Become Entitlements

1. `PLATFORM_TIER_FEATURES` (in `platform-tier-billing.ts`) defines per-tier string arrays
2. `buildPlatformTierEntitlements(tier)` converts strings → `PlanEntitlement[]` with keys `platform_tier_feat_0..N`
3. Stored in `CatalogPlan.metadata.entitlements` JSON
4. `syncEntitlementsToFlagRules(teamId, planId, entitlements)` creates:
   - `CatalogFeatureFlag` rows (one per feature)
   - `FlagRule` rows (source: "plan", priority: 100)
   - `FlagRuleCondition` rows (criteria: "base_plan", operator: "is_one_of")

### Where Entitlements Are Resolved

- **Embed SDK** → `resolveEntitlementResults()` in `entitlements.ts` → returns `data.entitlements` in `component-render.ts`
- **FlagRule evaluation** → `evaluateLoadedFlag()` checks `base_plan`, `add_on`, `usage`, `company_trait`, `user_trait` conditions
- **Metadata priority** → Plan metadata entitlements take priority over default flag rules

### When Entitlements Are Synced

- `ensureTierCatalogPlan()` — called during activation, renewal, and embed token generation
- `postPlatformBillingEmbed()` — called when loading the billing portal
- `setup:platform-billing` script — called during one-click setup

---

## Embed Component

### Configuration

- **Name**: `"ArcenPay Platform Billing"`
- **Elements**: `planManager`, `plansTable`, `invoices`
- **Design**: Black & white minimal (`primaryColor: #000000`, `cardStyle: minimal`)

### Behavior

- **Mode**: Default `"modal"` — plans/invoices shown inline, checkout opens in full-screen modal
- **Branding**: `hideBranding={true}` set in dashboard → "Secured by ArcenPay" footer hidden
- **On plan change**: Refreshes tier data, refreshes embed token, closes modal on success

### Token Lifecycle

1. Dashboard loads → `usePlatformBillingEmbed()` hook fetches `POST /api/platform/billing/embed-token`
2. Token cached in memory with 55-minute TTL (auto-refreshes 5 min before expiry)
3. Token used as `accessToken` prop on `<ArcenEmbed />`

---

## On-Chain Setup

### Bootstrap

```bash
npm run setup:billing -- --team-id <id>
# or skip on-chain:
npm run setup:billing -- --team-id <id> --skip-onchain
```

### What It Does

| Step | Action |
|------|--------|
| 1 | `bootstrapPlatformBillingPlans()` → deploys PLUS/PRO via `PlanFactory.createPlan()` on Arc testnet (chain 5042002) |
| 2 | Creates FREE/PLUS/PRO `CatalogPlan` entries with correct pricing + annualPrice |
| 3 | Builds entitlements from `PLATFORM_TIER_FEATURES` + syncs to `FlagRule` rows |
| 4 | Creates `ArcenCompany` + `SubscriptionState` as ACTIVE |
| 5 | Syncs `onChainPlanId` from `PlatformBillingPlan` → `CatalogPlan` |
| 6 | Creates `PlatformBillingCustomer` + `PlatformBillingAccount` |
| 7 | Creates embed component with black & white design |
| 8 | Associates company with active plan |

### Required Env Vars for Upgrades

```
PLATFORM_BILLING_OPS_PRIVATE_KEY=0x...    # ops signer private key
PLATFORM_BILLING_TREASURY_ADDRESS=0x...   # must match private key's address
PIMLICO_API_KEY=pim_...                   # for smart account bundler/paymaster
```

---

## Pricing & Invoice Flow

### Internal Amounts

- **Micros**: 1 USDC = 1,000,000 micros (internal calculation format)
- **Decimal**: Always converted before DB storage (via `toSix()`)
- **Bug fix** (2026-07-26): `activateTeamPlatformTier()` and `renewTeamPlatformTier()` were passing micros values to `toSix()` → invoices showed `$29,000,000` instead of `$29`. Now fixed to pass decimal `priceUsdPerMonth`.

### Invoice Creation

- **Activation**: `activateTeamPlatformTier()` creates PAID invoice with `AP-XXXX` number
- **Renewal**: `renewTeamPlatformTier()` creates PAID renewal invoice
- **Idempotency**: `platform.tier.activate:{teamId}:{tier}:{paymentAccount}:{txHash}` for activation, `platform.tier.renew:{teamId}:{tier}:{periodStart}` for renewal

---

## Key Files

| File | Role |
|------|------|
| `apps/arcen-backend/src/lib/catalog/tier-guard.ts` | Tier pricing, limits, guard functions (652 lines) |
| `apps/arcen-backend/src/lib/billing/platform-tier-billing.ts` | Core platform billing logic: activation, renewal, bootstrap, entitlements (1,600+ lines) |
| `apps/arcen-backend/src/routes/v1/platform/platform-billing-embed.ts` | Embed token generation (379 lines) |
| `apps/arcen-backend/src/routes/v1/platform/tier.ts` | Tier GET/POST endpoint |
| `apps/arcen-backend/src/routes/v1/platform/tier-prepare.ts` | On-chain upgrade tx encoding |
| `apps/arcen-backend/src/routes/v1/platform/tier-confirm.ts` | Upgrade tx verification + activation |
| `apps/arcen-backend/src/lib/entitlements/sync-entitlements.ts` | Entitlement → FlagRule sync |
| `apps/arcen-backend/src/lib/entitlements/entitlements.ts` | Runtime entitlement resolution |
| `apps/arcen-backend/scripts/setup-platform-billing.ts` | One-click setup script |
| `apps/arcen-dashboard/components/dashboard/sections/billing.tsx` | Dashboard billing UI (610 lines) |
| `apps/arcen-dashboard/hooks/use-platform-billing-embed.ts` | Embed token fetch + cache |
| `packages/sdk-react/src/components/ArcenEmbed.tsx` | ArcenEmbed SDK component |

---

## Decisions Record

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-26 | Removed custom "Compare Plans" UI in favor of ArcenEmbed SDK | Reduces duplicate code; SDK handles plansTable + checkout natively |
| 2026-07-26 | Removed fake `platform_feat_N` entitlements, replaced with `PLATFORM_TIER_FEATURES` | Detailed descriptive features match the old custom UI exactly |
| 2026-07-26 | Fixed micros→decimal bug in platform tier invoice creation | Was showing $29,000,000 instead of $29 for invoice totals |
| 2026-07-26 | Synced `onChainPlanId` from PlatformBillingPlan → CatalogPlan | SDK checkout requires `onChainPlanId` on CatalogPlan for paid tiers |
| 2026-07-26 | Added `hideBranding` prop to ArcenEmbed SDK | Platform's own embed shouldn't show "Secured by ArcenPay" |
| 2026-07-26 | Changed embed design to black & white (`primaryColor: #000000`) | Matches dashboard theme; orange looked out of place |
| 2026-07-26 | Added `assertCanCreateCheckoutSession` to checkout-sessions route | Guard existed but was never called |
| 2026-07-26 | Added chain count enforcement in environment creation | FREE tier advertised "1 chain" but it was never enforced |
| 2026-07-26 | Created `setup:billing` one-click script | Enables quick reset after DB clean or fresh deploy |

---

## Common Tasks

### Reset billing after database wipe
```bash
npm run setup:billing -- --team-id <id>
```

### Bootstrap missing on-chain plans
```bash
# The setup script handles this. Or call the bootstrap endpoint:
curl -X POST http://localhost:3300/api/v1/platform/tier/bootstrap
```

### Debug embed loading issues
1. Check embed token: `POST /api/platform/billing/embed-token`
2. Check component render: `GET /api/v1/components/:id/render?accessToken=...`
3. Verify `CatalogPlan.onChainPlanId` is set for PLUS/PRO
4. Verify `PlatformBillingPlan.syncStatus === "SYNCED"` for PLUS/PRO
5. Check browser console for SDK errors

### Check feature enforcement for a team
```sql
SELECT "platformTier" FROM "Team" WHERE id = '<teamId>';
-- Then cross-reference with DEFAULT_LIMITS in tier-guard.ts
```

### Update tier pricing
1. Update `TIER_PRICING` in `tier-guard.ts`
2. Update `platform-tier-billing.ts` line ~600 (`tierPricing()` uses `TIER_PRICING` automatically)
3. Update `platform-billing-embed.ts` lines ~97-110 (plan creation has inline pricing — keep in sync)
4. Update `BILLING-MEMORY.md` pricing table
5. Re-run `setup:billing --team-id <id> --skip-onchain` to update catalog plans
