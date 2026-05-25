"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ArcenPayProvider } from "@arcenpay/react";
import { useAuth } from "@clerk/nextjs";
import { ArcenIdentitySync } from "@/components/arcen/identity-sync";
import { ReceiptBillingProvider } from "@/components/providers/receipt-billing-provider";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export default function ConvexClientProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ArcenPayProvider
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
    >
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ArcenIdentitySync />
        <ReceiptBillingProvider>{children}</ReceiptBillingProvider>
      </ConvexProviderWithClerk>
    </ArcenPayProvider>
  );
}
