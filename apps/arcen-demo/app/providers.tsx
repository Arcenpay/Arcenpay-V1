"use client";

import type { ReactNode } from "react";
import { ArcenPayProvider } from "@arcenpay/react";

export function Providers({ children }: { children: ReactNode }) {
  const chainId =
    Number(
      process.env.NEXT_PUBLIC_CHAIN_ID ??
        process.env.NEXT_PUBLIC_MEAP_DEFAULT_CHAIN_ID,
    ) || 11155111;

  return (
    <ArcenPayProvider
      chainId={chainId}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
    >
      {children}
    </ArcenPayProvider>
  );
}
