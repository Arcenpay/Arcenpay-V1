"use client";

import { MEAPProvider } from "@meap/react";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MEAPProvider
      chainId={CHAIN_ID}
      walletConnectProjectId={process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
    >
      {children}
    </MEAPProvider>
  );
}
