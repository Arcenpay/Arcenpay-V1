# @arcenpay/react

> ArcenPay React SDK — drop-in components and hooks for Web3 subscription billing.

Add a complete USDC subscription billing flow to your React app in minutes. No payment processors, no KYC, funds go directly to your wallet.

## Installation

```bash
npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query
```

## Quick Start (5 minutes)

### 1. Wrap your app

```tsx
// app/layout.tsx (Next.js) or main.tsx (Vite)
import { ArcenPayProvider } from "@arcenpay/react";

export default function Layout({ children }) {
  return (
    <ArcenPayProvider
      chainId={84532}                                    // Base Sepolia testnet
      walletConnectProjectId="your-walletconnect-id"    // from cloud.walletconnect.com
    >
      {children}
    </ArcenPayProvider>
  );
}
```

### 2. Show a pricing table

```tsx
import { PricingTable, CheckoutModal } from "@arcenpay/react";
import { useState } from "react";

export function PricingPage() {
  const [selectedPlan, setSelectedPlan] = useState<bigint | null>(null);

  return (
    <>
      <PricingTable
        providerAddress="0xYourTreasuryWallet"
        onSelectPlan={setSelectedPlan}
      />

      {selectedPlan && (
        <CheckoutModal
          planId={selectedPlan}
          requestSubscription={async ({ planId, paymentAccount, subscriberEmail }) => {
            const response = await fetch("/api/request-subscription", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planId: planId.toString(),
                paymentAccount,
                subscriberEmail,
              }),
            });

            const result = await response.json();
            if (!response.ok) {
              throw new Error(result.error ?? "Activation failed");
            }

            return result;
          }}
          onSuccess={(tokenId) => {
            console.log("Subscribed!", tokenId.toString());
            setSelectedPlan(null);
          }}
          onClose={() => setSelectedPlan(null)}
        />
      )}
    </>
  );
}
```

### 3. Gate features

```tsx
import { FeatureFlagGuard, useEntitlement } from "@arcenpay/react";

// Component-level gating
function AdvancedFeature() {
  return (
    <FeatureFlagGuard flag="advanced_analytics">
      <AnalyticsDashboard />
    </FeatureFlagGuard>
  );
}

// Hook-level check
function MyComponent() {
  const { enabled, loading } = useEntitlement("advanced_analytics");

  if (loading) return <Spinner />;
  if (!enabled) return <UpgradePrompt />;
  return <AdvancedFeature />;
}
```

## All Components

### `<ArcenPayProvider />`

Root provider. Must wrap your entire app.

```tsx
<ArcenPayProvider
  chainId={8453}                          // Chain ID (default: 11155111 Sepolia)
  walletConnectProjectId="..."            // From cloud.walletconnect.com
  config={{
    // Optional: override defaults
    tablelandConfig: {
      featureFlagsEndpoint: "https://api.yourapp.com/flags/{wallet}",
    },
    tierFeatureFallback: {
      starter: { api_calls: 1000, webhooks: false },
      pro:     { api_calls: 10000, webhooks: true },
    },
  }}
>
  {children}
</ArcenPayProvider>
```

### `<PricingTable />`

Fetches plans from PlanFactory contract and displays them.

```tsx
<PricingTable
  providerAddress="0x..."      // Your wallet that receives payment
  planIds={[1n, 2n, 3n]}       // Or pass explicit plan IDs
  onSelectPlan={(planId) => {}}
  theme="dark"                  // "dark" | "light"
  className="my-pricing"
/>
```

### `<CheckoutModal />`

Full subscription checkout flow: connect wallet → deploy smart account → install autopay → request backend activation.

```tsx
<CheckoutModal
  planId={1n}
  requestSubscription={async ({ planId, paymentAccount, subscriberEmail }) => {
    const response = await fetch("/api/request-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: planId.toString(),
        paymentAccount,
        subscriberEmail,
      }),
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Activation failed");
    return result;
  }}
  onSuccess={(tokenId) => {
    // tokenId — ERC-721 subscription token ID
  }}
  onClose={() => {}}
/>
```

Your `requestSubscription` endpoint must run on your backend with an authorized
merchant signer. Direct customer-side calls to `SubscriptionRegistry.mint()` are
intentionally blocked because the contract only allows biller-controlled
activation.

### `<SubscriptionStatus />`

Shows current plan, expiry date, and USDC badge.

```tsx
<SubscriptionStatus />
```

### `<FeatureFlagGuard />`

Conditionally renders children based on feature flag.

```tsx
<FeatureFlagGuard
  flag="advanced_export"
  fallback={<UpgradePrompt />}    // Optional fallback
>
  <ExportButton />
</FeatureFlagGuard>
```

### `<UsageDashboard />`

Displays metered usage for the current session.

```tsx
<UsageDashboard planId={1n} />
```

### `<BillingHistory />` / `<InvoiceList />`

Customer-facing billing history and invoice download.

```tsx
<BillingHistory />
<InvoiceList providerUrl="https://api.yourapp.com" />
```

### `<ArcenEmbed />`

Render a published ArcenPay embed component (from the dashboard component builder).

```tsx
<ArcenEmbed
  componentId="your-component-id"
  providerUrl="https://api.yourapp.com"
/>
```

## Hooks

### `useArcenPay()`

Access the full protocol context.

```tsx
const { config, contracts, network, isTestnet } = useArcenPay();
```

### `useEntitlement(flag)`

Check a feature flag for the connected wallet.

```tsx
const {
  enabled,       // boolean
  loading,       // boolean
  value,         // boolean | string | number
  planTier,      // "starter" | "pro" | "enterprise"
  expiresAt,     // bigint (unix timestamp)
  isSubscribed,  // boolean
  error,         // Error | null
} = useEntitlement("advanced_analytics");
```

## Utilities

### `deploySmartAccount(config)`

Deploy a ZeroDev ERC-4337 smart account for a user (required for autopay).

```typescript
import { deploySmartAccount } from "@arcenpay/react";

const { address, client } = await deploySmartAccount({
  signer,       // viem WalletClient
  chainId: 8453,
});
```

### `revokeAutopayModule(config)`

Uninstall the autopay module (cancel subscription).

```typescript
import { revokeAutopayModule } from "@arcenpay/react";

await revokeAutopayModule({
  smartAccountAddress: "0x...",
  chainId: 8453,
});
```

## Custom UI Components

You can use your own UI and only use the hooks/data layer:

```tsx
import { useArcenPay } from "@arcenpay/react";
import { useReadContract } from "wagmi";
import { PlanFactoryABI } from "@arcenpay/sdk";

function MyCustomPricingTable() {
  const { contracts, network } = useArcenPay();

  // Read plans directly from the contract
  const { data: planIds } = useReadContract({
    address: contracts.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getProviderPlans",
    args: ["0xYourProviderAddress"],
    chainId: network.chainId,
  });

  // Build your own UI with planIds...
  return <YourDesign planIds={planIds} />;
}
```

## Environment Variables

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
NEXT_PUBLIC_RPC_URL_84532=https://sepolia.base.org
NEXT_PUBLIC_FACILITATOR_URL=https://facilitator.yourapp.com
```

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
