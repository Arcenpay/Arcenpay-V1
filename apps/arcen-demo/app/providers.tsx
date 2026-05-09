"use client";

import type { ReactNode } from "react";
import { ArcenPayProvider } from "@arcenpay/react";
import { resolveDemoArcenPayBaseUrl } from "@/lib/arcenpay-origin";

export function Providers({ children }: { children: ReactNode }) {
  const chainId =
    Number(
      process.env.NEXT_PUBLIC_CHAIN_ID ??
        process.env.NEXT_PUBLIC_MEAP_DEFAULT_CHAIN_ID,
    ) || 84532;

  return (
    <ArcenPayProvider
      baseUrl={resolveDemoArcenPayBaseUrl()}
      chainId={chainId}
      componentId={process.env.NEXT_PUBLIC_ARCENPAY_COMPONENT_ID}
      publishableKey={process.env.NEXT_PUBLIC_ARCENPAY_PUBLISHABLE_KEY}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
    >
      {children}
    </ArcenPayProvider>
  );
}
