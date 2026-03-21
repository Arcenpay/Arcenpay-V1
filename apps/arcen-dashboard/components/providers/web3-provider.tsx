"use client";

import { wagmiAdapter, projectId } from "@/lib/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { mainnet, base, sepolia, baseSepolia } from "@reown/appkit/networks";
import React, { type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { ApolloProvider } from "@apollo/client";
import { Toaster } from "sonner";
import { apolloClient } from "@/lib/graphql";

const queryClient = new QueryClient();

// Dynamic metadata URL based on environment
const getMetadataUrl = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || "https://arcenpay.xyz";
};

// Initialize AppKit once at module scope
createAppKit({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapters: [wagmiAdapter as any],
  projectId,
  networks: [base, baseSepolia, sepolia, mainnet],
  defaultNetwork: base,
  metadata: {
    name: "ArcenPay Dashboard",
    description: "ArcenPay Provider Dashboard",
    url: getMetadataUrl(),
    icons: ["/icon.svg"],
  },
  features: {
    analytics: true,
  },
  themeMode: "light" as const,
  themeVariables: {
    "--w3m-accent": "#0000ff",
    "--w3m-border-radius-master": "2px",
  },
});

export function Web3Provider({
  children,
  cookies,
}: {
  children: ReactNode;
  cookies: string | null;
}) {
  const initialState = cookieToInitialState(
    wagmiAdapter.wagmiConfig as Config,
    cookies,
  );

  return (
    <WagmiProvider
      config={wagmiAdapter.wagmiConfig as Config}
      initialState={initialState}
    >
      <QueryClientProvider client={queryClient}>
        <ApolloProvider client={apolloClient}>
          {children}
          <Toaster richColors position="bottom-right" />
        </ApolloProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
