"use client";

import { wagmiAdapter, projectId } from "@/lib/wagmi";
import { DEFAULT_CHAIN_ID } from "@/lib/default-chain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { mainnet, base, sepolia, baseSepolia } from "@reown/appkit/networks";
import React, { type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { ApolloProvider } from "@apollo/client";
import { Toaster } from "sonner";
import { apolloClient } from "@/lib/graphql";

const queryClient = new QueryClient();

const defaultNetwork =
  DEFAULT_CHAIN_ID === 8453
    ? base
    : DEFAULT_CHAIN_ID === 11155111
      ? sepolia
      : baseSepolia;

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
  networks: [baseSepolia, base, sepolia, mainnet],
  defaultNetwork,
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
  const initialState = resolveInitialState(cookies);

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

function decodeCookieValues(cookieHeader: string): string {
  return cookieHeader
    .split(";")
    .map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) return trimmed;

      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) return trimmed;

      const name = trimmed.slice(0, eqIndex);
      const value = trimmed.slice(eqIndex + 1);

      try {
        return `${name}=${decodeURIComponent(value)}`;
      } catch {
        return `${name}=${value}`;
      }
    })
    .filter(Boolean)
    .join("; ");
}

function resolveInitialState(cookies: string | null) {
  if (!cookies) return undefined;

  try {
    return cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies);
  } catch (error) {
    const decodedCookies = decodeCookieValues(cookies);
    if (decodedCookies !== cookies) {
      try {
        return cookieToInitialState(
          wagmiAdapter.wagmiConfig as Config,
          decodedCookies,
        );
      } catch {
        // Fall through to undefined below.
      }
    }
    console.warn("[web3-provider] Falling back to empty wagmi initial state:", error);
    return undefined;
  }
}
