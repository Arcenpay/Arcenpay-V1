# AcmeScan — ArcenPay SDK Demo App

A full SaaS demo app that uses every component and hook from the `@meap/react` SDK, backed by `@meap/node` server-side calls. Demonstrates the complete ArcenPay integration: subscriptions, feature flags, usage tracking, on-chain billing, and embedded portals.

## SDK Components Used

| Component / Hook | Tab | What It Shows |
|---|---|---|
| `MEAPProvider` | All | Wagmi + React Query + protocol context |
| `SubscriptionStatus` | Plans | Current subscription tier + expiry |
| `PricingTable` | Plans | On-chain plan tiers from PlanFactory |
| `CheckoutModal` | Plans | Full on-chain subscribe flow |
| `FeatureFlagGuard` | Features | Gate content by entitlement + fallback |
| `useFlag` | Features | Real-time single flag check |
| `useFlags` | Features | Bulk flag check (4 flags at once) |
| `useTrack` | Usage | Send usage events to the protocol |
| `UsageDashboard` | Usage | Live ZKVUB session metrics (on-chain) |
| `BillingHistory` | Billing | On-chain SubscriptionRegistry events |
| `ArcenEmbed` | Portal | Embedded self-serve billing portal |

## Setup

### 1. Start the dashboard

```bash
cd apps/arcen-dashboard
pnpm dev
# Dashboard → http://localhost:3000
```

### 2. Create an API key

1. Open http://localhost:3000
2. Sign in → create/join an organization
3. Go to **Settings** → **Protocol Keys** tab
4. Click **Create API Key** → copy the key (shown once!)

### 3. Create feature flags (recommended)

In the dashboard, create flags with these keys:
- `scan`
- `advanced_analytics`
- `api_access`
- `custom_exports`
- `sso`

Optionally set company overrides to `true` to see them enabled.

### 4. Run the demo

```bash
# Option A: Setup screen (no env file needed)
cd apps/arcen-demo
pnpm dev
# Open http://localhost:3001
# Enter your API key in the setup screen

# Option B: .env.local
cp .env.local.example .env.local
# Edit .env.local with your API key
pnpm dev
```

## Architecture

```
app/
├── layout.tsx              # Root layout — wraps children with <Providers>
├── providers.tsx           # Client component: <MEAPProvider> (Wagmi + React Query)
├── page.tsx                # Main demo — 5 tabs, all SDK components
├── globals.css             # Dark theme + meap-* CSS classes for SDK components
└── api/
    ├── access-token/       # POST — ArcenClient.createAccessToken()
    ├── company/            # GET/POST — list/identify companies
    ├── config/             # GET/POST — store API key at runtime (setup screen)
    ├── events/             # GET — proxy /api/v1/events feed
    ├── flags/              # GET — ArcenClient.checkFlags()
    └── track/              # POST — ArcenClient.track()

lib/
└── arcen-client.ts         # ArcenClient singleton (env → runtime config fallback)
```

## Tabs

| Tab | Components |
|---|---|
| **Plans** | `SubscriptionStatus` + `PricingTable` + `CheckoutModal` |
| **Features** | `FeatureFlagGuard` + `useFlag` + `useFlags` |
| **Usage** | `useTrack` event buttons + `UsageDashboard` |
| **Billing** | `BillingHistory` |
| **Portal** | `ArcenEmbed` (requires access token from `/api/access-token`) |

## On-Chain Requirements

The following components require a wallet connection and active testnet contracts:
- `SubscriptionStatus` — reads from `SubscriptionRegistry`
- `PricingTable` — reads from `PlanFactory`
- `CheckoutModal` — writes to `SubscriptionRegistry`
- `UsageDashboard` — reads from `SessionVault` + `ZKUsageVerifier`
- `BillingHistory` — queries `SubscriptionRegistry` logs

Feature flag hooks (`useFlag`, `useFlags`, `useTrack`) work without a wallet using the email fallback company identity.
