"use client";

import { defaultNetwork, networks, wagmiAdapter, projectId } from "@/lib/wagmi";
import { DASHBOARD_APP_URL } from "@/lib/site-config";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createAppKit } from "@reown/appkit/react";
import { useTheme } from "next-themes";
import React, { useEffect, type ReactNode } from "react";
import { cookieToInitialState, WagmiProvider, type Config } from "wagmi";
import { reconnect, connect } from "@wagmi/core";
import { ApolloProvider } from "@apollo/client";
import { Toaster } from "sonner";
import { apolloClient } from "@/lib/graphql";
import { SolanaWalletProvider } from "@/components/providers/solana-wallet-provider";

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
const isLocalhost =
  appOrigin.includes("localhost") || appOrigin.includes("127.0.0.1");

// For WalletConnect / Reown metadata:
// In production, metadataUrl is appOrigin.
// On localhost, fallback to canonical https://app.arcenpay.com so mobile wallets (MetaMask, Rainbow)
// verify the domain against Reown Cloud registry instead of showing an unverified/suspicious domain warning.
const metadataUrl = isLocalhost ? "https://app.arcenpay.com" : appOrigin;
const metadataIcons = [
  "https://app.arcenpay.com/apple-icon.png",
  "https://app.arcenpay.com/arcenpay-logo.png",
  "https://avatars.githubusercontent.com/u/263876770?s=200&v=4",
  `${appOrigin}/apple-icon.png`,
  `${appOrigin}/arcenpay-logo.png`,
];

// Initialize AppKit once at module scope — themeMode updated dynamically below
export const appKit = createAppKit({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapters: [wagmiAdapter as any],
  projectId,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  networks: networks as any,
  defaultNetwork,
  metadata: {
    name: "ArcenPay",
    description: "ArcenPay — Web3 Entitlement & Billing Platform",
    url: metadataUrl,
    icons: metadataIcons,
    redirect: {
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
  universalProviderConfigOverride: {
    methods: {
      eip155: [
        "eth_sendTransaction",
        "personal_sign",
        "eth_signTypedData",
        "eth_signTypedData_v4",
        "eth_sign",
        "eth_accounts",
        "eth_requestAccounts",
        "wallet_switchEthereumChain",
        "wallet_addEthereumChain",
        "wallet_getPermissions",
        "wallet_requestPermissions",
        "wallet_watchAsset",
        "wallet_getCapabilities",
        "wallet_getCallsStatus",
        "wallet_sendCalls",
      ],
    },
    chains: {
      eip155: [
        "eip155:1",
        "eip155:8453",
        "eip155:84532",
        "eip155:11155111",
        "eip155:5042002",
        "eip155:677",
        "eip155:968",
      ],
    },
    events: {
      eip155: ["accountsChanged", "chainChanged"],
    },
    rpcMap: {
      "eip155:1": "https://ethereum-rpc.publicnode.com",
      "eip155:8453": "https://mainnet.base.org",
      "eip155:84532": "https://base-sepolia-rpc.publicnode.com",
      "eip155:11155111": "https://ethereum-sepolia-rpc.publicnode.com",
      "eip155:5042002": "https://rpc.testnet.arc.network",
      "eip155:677": "https://rpc.botchain.ai",
      "eip155:968": "https://rpc.testnet.botchain.ai",
    },
  },
  themeMode: "light",
  themeVariables: {
    "--w3m-accent": "#6366f1",
    "--w3m-border-radius-master": "2px",
  },
});

if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__ARCEN_APPKIT__ = appKit;

  wagmiAdapter.wagmiConfig.subscribe(
    (state) => state.status,
    (status) => {
      if (status === "connected") {
        try {
          appKit.close();
        } catch {}
      }
    },
  );
}

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
          <WcProviderListener />
          <SolanaWalletProvider>{children}</SolanaWalletProvider>
          <Toaster richColors position="bottom-right" />
        </ApolloProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Direct WalletConnect provider listener:
 * Catches both fresh session connections and permission updates (session_update,
 * accountsChanged) when mobile MetaMask re-authorizes or connects via QR code.
 */
function WcProviderListener() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let isMounted = true;
    let pollInterval: NodeJS.Timeout | null = null;
    const config = wagmiAdapter.wagmiConfig as Config;

    const setupListener = async () => {
      try {
        const wcConnector = config.connectors.find((c) => c.id === "walletConnect");
        if (!wcConnector) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const provider = (await wcConnector.getProvider()) as any;
        if (!provider || !isMounted) return;

        // Expunge any stale inactive pairings so newly generated QR codes are clean
        if (provider?.client?.pairing?.getAll) {
          try {
            const pairings = provider.client.pairing.getAll();
            for (const p of pairings) {
              if (!p.active) {
                try {
                  provider.client.core.expirer.set(p.topic, 0);
                } catch {}
              }
            }
          } catch {}
        }

        const handleSync = async () => {
          if (config.state.status === "connected") {
            try {
              appKit.close();
            } catch {}
            return;
          }

          console.info(
            "[Web3Provider] WalletConnect session update/connect detected. Syncing Wagmi...",
          );
          try {
            await reconnect(config, { connectors: [wcConnector] });
          } catch {
            try {
              await connect(config, { connector: wcConnector });
            } catch {}
          } finally {
            try {
              appKit.close();
            } catch {}
          }
        };

        // Listen for new connections
        provider.on?.("connect", handleSync);
        // Listen for existing session updates / permission changes
        provider.on?.("accountsChanged", handleSync);
        provider.on?.("chainChanged", handleSync);
        provider.client?.on?.("session_update", handleSync);
        provider.client?.on?.("session_extend", handleSync);
        provider.client?.on?.("session_event", handleSync);

        // Immediate check if session is already active
        if (provider.session && config.state.status !== "connected") {
          void handleSync();
        }

        // Active polling fallback: while disconnected, check if provider.session became active
        pollInterval = setInterval(() => {
          if (!isMounted) return;
          if (provider.session && config.state.status !== "connected") {
            void handleSync();
          }
        }, 1000);
      } catch {}
    };

    void setupListener();

    return () => {
      isMounted = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return null;
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

      isSyncing = true;
      try {
        // 1. Kick WalletConnect relayer transport to unfreeze paused WebSockets on mobile tab resume
        const wcConnector = config.connectors.find((c) => c.id === "walletConnect");
        if (wcConnector) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const provider = (await wcConnector.getProvider()) as any;
            if (provider?.client?.core?.relayer?.restartTransport) {
              await provider.client.core.relayer.restartTransport();
            }
            if (provider?.session && config.state.status !== "connected") {
              await wcConnector.connect();
              appKit.close();
            }
          } catch {}
        }

        // 2. Reconnect Wagmi state if disconnected
        if (config.state.status !== "connected") {
          await reconnect(config);
        }

        if (config.state.status === "connected") {
          appKit.close();
        }
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
