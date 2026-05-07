# @arcenpay/react

> ArcenPay React SDK — drop-in components and hooks for Web3 subscription billing.

Add a complete USDC subscription billing flow to your React app in minutes. No payment processors, no KYC, funds go directly to your wallet.

## Installation

```bash
npm install @arcenpay/react
```

Common UI-facing ArcenPay types are exported from `@arcenpay/react`, so most
frontend integrations only need `@arcenpay/react`.

## Quick Start (5 minutes)

### 1. Wrap your app

```tsx
// app/layout.tsx (Next.js) or main.tsx (Vite)
import { ArcenPayProvider } from "@arcenpay/react";

export default function Layout({ children }) {
  return (
    <ArcenPayProvider
      publishableKey="pk_..."
      componentId="your-component-id"
      chainId={84532}
      walletConnectProjectId="your-walletconnect-id"
    >
      {children}
    </ArcenPayProvider>
  );
}
```

### 2. Render the billing portal

```tsx
import { ArcenEmbed } from "@arcenpay/react";

export function BillingPage() {
  return (
    <ArcenEmbed componentId="your-component-id" />
  );
}
```

### 3. Gate features

```tsx
import {
  useEntitlement,
  useConsumeEntitlement,
  useFlag,
} from "@arcenpay/react";

function MyComponent({ walletAddress }: { walletAddress: string }) {
  const enabled = useFlag("advanced_analytics");
  const { consume } = useConsumeEntitlement();
  const { planTier, isSubscribed } = useEntitlement(walletAddress);

  async function handleScan() {
    const result = await consume("scan");
    if (!result.consumed) {
      alert(result.reason);
      return;
    }
  }

  if (!enabled) return <UpgradePrompt />;
  return (
    <AnalyticsDashboard
      planTier={planTier}
      subscribed={isSubscribed}
      onScan={handleScan}
    />
  );
}
```

## All Components

### `<ArcenPayProvider />`

Root provider. Must wrap your entire app.

```tsx
<ArcenPayProvider
  publishableKey="pk_..."
  componentId="your-component-id"
  chainId={84532}
  walletConnectProjectId="..."
>
  {children}
</ArcenPayProvider>
```

### `<ArcenEmbed />`

Render a published ArcenPay embed component (from the dashboard component builder).

```tsx
<ArcenEmbed componentId="your-component-id" />
```

### `<FeatureFlagGuard />`

Show or hide UI behind an entitlement check.

```tsx
<FeatureFlagGuard featureKey="advanced_analytics" walletAddress={address}>
  <PremiumAnalytics />
</FeatureFlagGuard>
```

### `<TemplateRenderer />`

Render saved template blocks when you are building custom component experiences.

```tsx
<TemplateRenderer name="upgrade-card" blocks={blocks} />
```

## Hooks

### `useArcenPay()`

Access the full protocol context.

```tsx
const { config, contracts, network, isTestnet } = useArcenPay();
```

### `useEntitlement(walletAddress, featureKey?)`

Read the live on-chain subscription state for a wallet and resolve feature values
with this precedence:
1. dashboard company entitlements when an Arcen session token is available
2. wallet/provider compatibility endpoint
3. `tierFeatureFallback`

```tsx
const {
  planTier,      // "starter" | "pro" | "enterprise"
  expiresAt,     // bigint (unix timestamp)
  isSubscribed,  // boolean
  features,      // resolved feature map
  isLoading,     // boolean
  error,         // Error | null
} = useEntitlement("0xabc...", "advanced_analytics");
```

### `useFlag(featureKey)` / `useFlags(featureKeys)`

Check one or many dashboard-managed feature flags.

```tsx
const analyticsEnabled = useFlag("advanced_analytics");
const flags = useFlags(["advanced_analytics", "priority_support"]);
```

### `useTrack()`

Send analytics events to the dashboard. When an Arcen session token is present,
the session is used automatically.

```tsx
const { track } = useTrack();

await track("export_triggered", { format: "csv" });
```

### `useConsumeEntitlement()`

Atomically enforce and consume a metered entitlement on the server.

```tsx
const { consume, loading } = useConsumeEntitlement();

const result = await consume({
  featureKey: "scan",
  idempotencyKey: crypto.randomUUID(),
});

if (!result.consumed) {
  console.log(result.reason);
}
```

## Custom UI Components

You can use your own UI and only use the hooks/data layer:

```tsx
import { useFlag, useConsumeEntitlement } from "@arcenpay/react";

function MyCustomUpgradePrompt() {
  const enabled = useFlag("advanced_analytics");
  const { consume } = useConsumeEntitlement();

  if (!enabled) return <UpgradeCTA />;

  return (
    <button onClick={() => consume("scan")}>
      Run premium action
    </button>
  );
}
```

## Environment Variables

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
NEXT_PUBLIC_RPC_URL_84532=https://sepolia.base.org
NEXT_PUBLIC_ARCEN_BASE_URL=https://dashboard.yourapp.com
NEXT_PUBLIC_FACILITATOR_URL=https://facilitator.yourapp.com
NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY=pk_...
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=your-component-id
```

## Package Boundary

For frontend integrations, use `@arcenpay/react` only. The package re-exports
the public React types you need, so consumers should not need `@arcenpay/sdk`
or internal ArcenPay package paths.

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
