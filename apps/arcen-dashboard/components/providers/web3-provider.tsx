"use client";

import { defaultNetwork, networks, wagmiAdapter, projectId } from "@/lib/wagmi";
import { DASHBOARD_APP_URL } from "@/lib/site-config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { useTheme } from "next-themes";
import React, { useEffect, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { reconnect } from "@wagmi/core";
import { ApolloProvider } from "@apollo/client";
import { Toaster } from "sonner";
import { apolloClient } from "@/lib/graphql";

const queryClient = new QueryClient();

function getAppOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return DASHBOARD_APP_URL.startsWith("http")
    ? DASHBOARD_APP_URL
    : `https://${DASHBOARD_APP_URL}`;
}

const appOrigin = getAppOrigin();
const appIconUrl = `${appOrigin}/icon.svg`;

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
    url: appOrigin,
    icons: [appIconUrl],
    redirect: {
      native: "arcenpay://",
      universal: appOrigin,
    },
  } as any,
  featuredWalletIds: [
    "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96", // MetaMask
    "1ae92b26bf70ab128b6e9e49c5b97212803c347dec060829b1031709663ddd1e", // Rainbow
    "fd20dc426fb3704d16949ec3d1023dce8389606639037746bd97b1bceee4cfdb", // Coinbase
    "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0", // Trust
  ],
  allWallets: "SHOW",
  enableWalletConnect: true,
  enableInjected: true,
  enableCoinbase: true,
  allowUnsupportedChain: true,
  features: {
    analytics: true,
    allWallets: true,
    email: false,
    socials: [],
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
          <MobileWalletSync />
          {children}
          <Toaster richColors position="bottom-right" />
        </ApolloProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Automatically syncs connection status when returning from native mobile wallet apps.
 * When switching between the browser and external wallets (MetaMask, Rainbow, etc.),
 * mobile operating systems (iOS Safari, Android Chrome) freeze background tabs.
 * Upon tab resume, this triggers Wagmi to detect the approved session and update state immediately.
 */
function MobileWalletSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let isSyncing = false;
    const syncConnection = async () => {
      if (document.visibilityState !== "visible" || isSyncing) return;
      const config = wagmiAdapter.wagmiConfig as Config;
      if (config.state.status === "connected") return;

      isSyncing = true;
      try {
        await reconnect(config);
      } catch {
        // Silently swallow reconnect attempts on tab focus
      } finally {
        isSyncing = false;
      }
    };

    document.addEventListener("visibilitychange", syncConnection);
    window.addEventListener("focus", syncConnection);

    return () => {
      document.removeEventListener("visibilitychange", syncConnection);
      window.removeEventListener("focus", syncConnection);
    };
  }, []);

  return null;
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
