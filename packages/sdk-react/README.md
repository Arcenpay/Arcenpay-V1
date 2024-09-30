# @arcenpay/react

ArcenPay React SDK for published billing components, customer identification,
entitlement-aware UI, and metered usage.

## Install

```bash
npm install @arcenpay/react
```

## Quick start

Wrap your app:

```tsx
"use client";

import { ArcenPayProvider } from "@arcenpay/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ArcenPayProvider
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
    >
      {children}
    </ArcenPayProvider>
  );
}
```

Identify the active customer:

```tsx
import { useEffect } from "react";
import { useArcenPay } from "@arcenpay/react";

export function BillingIdentity({ wallet }: { wallet: string }) {
  const { identify } = useArcenPay();

  useEffect(() => {
    if (!wallet) return;
    void identify({
      company: { id: "company_123", wallet },
      user: { id: "user_123", wallet },
    });
  }, [identify, wallet]);

  return null;
}
```

Render the billing surface:

```tsx
import { ArcenEmbed } from "@arcenpay/react";

export function BillingPage() {
  return <ArcenEmbed mode="modal" />;
}
```

## Main exports

- `ArcenPayProvider`
- `useArcenPay`
- `ArcenEmbed`
- `FeatureFlagGuard`
- `TemplateRenderer`
- `useFlag`
- `useFlags`
- `useEntitlement`
- `useConsumeEntitlement`
- `useTrack`

> **Payment links are a server-side concern.** Create and manage them with the
> Node SDK (`@arcenpay/node` → `client.createPaymentLink()` /
> `listPaymentLinks()` / `updatePaymentLink()`), the dashboard, or the Agent
> SDK (`@arcenpay/agent` → `agent.createPaymentLink()`). The hosted checkout
> URL returned by those APIs (`checkoutUrl`) is what your React app should
> redirect users to.

## Common hook usage

```tsx
import {
  useConsumeEntitlement,
  useEntitlement,
  useFlag,
  useFlags,
  useTrack,
} from "@arcenpay/react";

const scanEnabled = useFlag("scan");
const flags = useFlags(["scan", "export-pdf"]);
const entitlement = useEntitlement(walletAddress, "scan");
const { consume } = useConsumeEntitlement();
const { track } = useTrack();

await consume("scan");
await track("scan_started", { source: "dashboard" });
```

## Optional embed-token path

If you mint a short-lived token on your backend, you can pass it directly to
`ArcenEmbed`:

```tsx
<ArcenEmbed accessToken={token} componentId="cmp_123" />
```

## Environment variables

```bash
NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY=pk_xxxxxxxxx
NEXT_PUBLIC_ARCENPAY_COMPONENT_ID=cmp_xxxxxxxxx
NEXT_PUBLIC_CHAIN_ID=84532
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=xxxxxxxxx
```

The SDK handles its internal routing defaults automatically. App code should
not pass custom base URLs during normal usage.

## Boundary

Use `@arcenpay/react` for browser-side billing experiences. Keep secure billing
decisions, company APIs, activation, and webhook verification in
`@arcenpay/node`.
