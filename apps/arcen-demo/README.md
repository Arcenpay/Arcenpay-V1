# AcmeScan — ArcenPay SDK Demo App

A full SaaS demo app that uses the ArcenPay SDK to demonstrate feature flags, event tracking, and company management in a real React application.

## What This Demonstrates

| Feature | SDK Usage |
|---------|-----------|
| Feature flag check (single) | `useFlag(key, companyKeys)` |
| Feature flag check (bulk) | `useFlags([...keys], companyKeys)` |
| Usage event tracking | `useTrack()` → `track({ name, company })` |
| Company upsert (identify) | `ArcenClient.identify()` (server-side) |
| Company list/get | `ArcenClient.listCompanies()` (server-side) |
| Flag check server-side | `ArcenClient.checkFlags()` (server-side) |
| Live events feed | Direct API polling via `/api/v1/events` |

## Setup

### 1. Start the dashboard

```bash
cd apps/arcen-dashboard
pnpm dev
# Dashboard runs on http://localhost:3000
```

### 2. Create an API key

1. Open http://localhost:3000
2. Sign in → create/join an organization
3. Go to **Settings** → **Protocol Keys** tab
4. Click **Create API Key**
5. Copy the key (shown once!)

### 3. Create some feature flags (optional but recommended)

1. Go to **Feature Flags** in the dashboard
2. Create flags with these keys to see them in the demo:
   - `scan`
   - `advanced_analytics`
   - `api_access`
   - `custom_exports`
   - `sso`
3. Optionally set a company override to true so they show as enabled

### 4. Run the demo app

```bash
# Option A: Use the setup screen (no env file needed)
cd apps/arcen-demo
pnpm dev
# Open http://localhost:3001
# Enter your API key in the setup screen

# Option B: Use .env.local
cp .env.local.example .env.local
# Edit .env.local with your API key
pnpm dev
```

## App Structure

```
app/
├── page.tsx              # Main demo UI (all SDK usage happens here)
├── layout.tsx            # Root layout
├── globals.css           # Dark theme styles
└── api/
    ├── company/route.ts  # Uses ArcenClient.identify() + listCompanies()
    ├── flags/route.ts    # Uses ArcenClient.checkFlags()
    ├── track/route.ts    # Uses ArcenClient.track()
    ├── events/route.ts   # Proxies /api/v1/events
    └── config/route.ts   # Stores config for server routes

lib/
└── arcen-client.ts       # ArcenClient singleton from @meap/node
```

## SDK Packages Used

- **`@meap/react`** — `useFlag`, `useFlags`, `useTrack` React hooks
- **`@meap/node`** — `ArcenClient` for server-side API calls
- **`@meap/core`** — TypeScript types (`SchematicCompany`, `FlagCheckResult`, etc.)
