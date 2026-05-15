"use client";

import { defaultNetwork, networks, wagmiAdapter, projectId } from "@/lib/wagmi";
import { DASHBOARD_APP_URL } from "@/lib/site-config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { useTheme } from "next-themes";
import React, { useEffect, type ReactNode } from "react";
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
  return DASHBOARD_APP_URL;
};

// Initialize AppKit once at module scope — themeMode updated dynamically below
createAppKit({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapters: [wagmiAdapter as any],
  projectId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  networks: networks as any,
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
  themeMode: "light",
  themeVariables: {
    "--w3m-accent": "#6366f1",
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
          <ThemeSync />
          {children}
          <Toaster richColors position="bottom-right" />
        </ApolloProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/** Syncs the next-themes resolved theme to the AppKit wallet modal. */
function ThemeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (typeof window !== "undefined") {
      // AppKit reads a data attribute for dark mode; toggle the html class accordingly
      const root = document.documentElement;
      if (resolvedTheme === "dark") {
        root.setAttribute("data-wallet-theme", "dark");
      } else {
        root.setAttribute("data-wallet-theme", "light");
      }
    }
  }, [resolvedTheme]);

  return null;
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
