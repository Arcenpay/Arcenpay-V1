"use client";

import { MEAPProvider } from "@meap/react";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const chainId =
    Number(process.env.NEXT_PUBLIC_CHAIN_ID) || 11155111; // Sepolia testnet

  return (
    <MEAPProvider
      chainId={chainId}
      walletConnectProjectId={
        process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
      }
    >
      {children}
    </MEAPProvider>
  );
}
