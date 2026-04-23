# @arcenpay/react

> ArcenPay React SDK — drop-in components and hooks for Web3 subscription billing.

Add a complete USDC subscription billing flow to your React app in minutes. No payment processors, no KYC, funds go directly to your wallet.

## Installation

```bash
npm install @arcenpay/react @arcenpay/sdk wagmi viem @tanstack/react-query
```

If you use the optional ZeroDev smart-account helpers, also install:

```bash
npm install @zerodev/sdk @zerodev/ecdsa-validator
```

## Quick Start (5 minutes)

### 1. Wrap your app

```tsx
// app/layout.tsx (Next.js) or main.tsx (Vite)
import { ArcenPayProvider } from "@arcenpay/react";

export default function Layout({ children }) {
  return (
    <ArcenPayProvider
      chainId={84532}                                    // Base Sepolia
      walletConnectProjectId="your-walletconnect-id"    // from cloud.walletconnect.com
      token="short-lived-access-token-from-your-backend"
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
import {
  useEntitlementCheck,
  useEntitlement,
  useConsumeEntitlement,
} from "@arcenpay/react";
import { useAccount } from "wagmi";

function MyComponent() {
  const { address } = useAccount();
  const { enabled, loading } = useEntitlementCheck("advanced_analytics");
  const { consume } = useConsumeEntitlement();
  const { planTier, isSubscribed } = useEntitlement(address);

  async function handleScan() {
    const result = await consume("scan");
    if (!result.consumed) {
      alert(result.reason);
      return;
    }
  }

  if (loading) return <Spinner />;
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
  chainId={84532}                         // Chain ID (default: 84532 Base Sepolia)
  walletConnectProjectId="..."            // From cloud.walletconnect.com
  config={{
    // Optional: override defaults
    tablelandConfig: {
      featureFlagsEndpoint: "https://api.yourapp.com/api/entitlements/{wallet}/flags",
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
  activationEndpoint="https://dashboard.yourapp.com/api/v1/subscriptions/activate"
  onSuccess={(tokenId) => {
    // tokenId — ERC-721 subscription token ID
  }}
  onClose={() => {}}
/>
```

If you already have a provider backend, you can keep using `requestSubscription`.
If not, `CheckoutModal` can call the ArcenPay dashboard activation endpoint
directly when `activationEndpoint` or `NEXT_PUBLIC_ARCEN_BASE_URL` /
`NEXT_PUBLIC_ARCENPAY_BASE_URL` is configured.

Do not pass a secret API key to `ArcenPayProvider` in the browser.
Mint short-lived access tokens on your backend and pass `token`, or provide
an `identify` callback that calls your own backend endpoint.

### `<SubscriptionStatus />`

Shows current plan, expiry date, and USDC badge.

```tsx
<SubscriptionStatus />
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

### `useEntitlement(walletAddress, featureKey?)`

Read the live on-chain subscription state for a wallet and resolve feature values
with this precedence:
1. dashboard company entitlements when an Arcen session token is available
2. wallet/provider compatibility endpoint
3. `tierFeatureFallback`

```tsx
const { address } = useAccount();

const {
  planTier,      // "starter" | "pro" | "enterprise"
  expiresAt,     // bigint (unix timestamp)
  isSubscribed,  // boolean
  features,      // resolved feature map
  isLoading,     // boolean
  error,         // Error | null
} = useEntitlement(address, "advanced_analytics");
```

### `useEntitlementCheck(featureKey)`

Check a single company-aware entitlement through the dashboard API.

```tsx
const {
  enabled,
  allocation,
  usage,
  exceeded,
  loading,
  error,
} = useEntitlementCheck("api_calls");
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

## Utilities

### `deploySmartAccount(config)`

Deploy a ZeroDev ERC-4337 smart account for a user (required for autopay).

```typescript
import { deploySmartAccount } from "@arcenpay/react/zerodev";

const { address, client } = await deploySmartAccount({
  signer,       // viem WalletClient
  chainId: 84532,
});
```

### `revokeAutopayModule(config)`

Uninstall the autopay module (cancel subscription).

```typescript
import { revokeAutopayModule } from "@arcenpay/react/zerodev";

await revokeAutopayModule({
  smartAccountAddress: "0x...",
  chainId: 84532,
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
NEXT_PUBLIC_ARCEN_BASE_URL=https://dashboard.yourapp.com
NEXT_PUBLIC_FACILITATOR_URL=https://facilitator.yourapp.com
```

---

Part of the [ArcenPay](https://arcenpay.xyz) SDK suite.
