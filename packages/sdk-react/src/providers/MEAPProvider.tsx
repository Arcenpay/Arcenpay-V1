"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia, baseSepolia, base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MEAPConfig, ContractAddresses, NetworkConfig } from "@arcenpay/sdk";
import {
  getChainEnvironment,
  DEFAULT_CHAIN_ID,
  validateChainEnvironment,
} from "@arcenpay/sdk";
import { resolveDashboardBaseUrl } from "../lib/api";

// ============================================================
//  MEAPProvider / ArcenPayProvider — Root Context Provider
//  Wraps application with Wagmi + React Query + protocol config
// ============================================================

export interface MEAPContextValue {
  config: MEAPConfig;
  contracts: ContractAddresses;
  network: NetworkConfig;
  isTestnet: boolean;
}

/** @alias MEAPContextValue */
export type ArcenPayContextValue = MEAPContextValue;

const MEAPContext = createContext<MEAPContextValue | null>(null);

// ─── Session Context ──────────────────────────────────────────────────────────

export interface ArcenSessionContextValue {
  token: string | null;
  companyId: string | null;
  userId: string | null;
  isReady: boolean;
  identify: (input: ArcenIdentifyInput) => Promise<ArcenIdentifyResult>;
} 

export interface ArcenIdentifyInput {
  company?: {
    id?: string;
    wallet?: string;
    email?: string;
    name?: string;
    traits?: Record<string, unknown>;
  };
  user?: {
    id?: string;
    clerkUserId?: string;
    wallet?: string;
    email?: string;
    name?: string;
  };
  expiresIn?: number;
}

export interface ArcenIdentifyResult {
  token: string;
  companyId: string;
  userId: string | null;
}

const ArcenSessionContext = createContext<ArcenSessionContextValue>({
  token: null,
  companyId: null,
  userId: null,
  isReady: false,
  identify: async () => {
    throw new Error("Arcen session provider is not ready");
  },
});

export function useArcenSession(): ArcenSessionContextValue {
  return useContext(ArcenSessionContext);
}

export function useArcenIdentify(): ArcenSessionContextValue["identify"] {
  return useArcenSession().identify;
}

export interface MEAPProviderProps {
  children: ReactNode;
  config?: Partial<MEAPConfig>;
  chainId?: number;
  walletConnectProjectId?: string;
  apiKey?: string;
  token?: string;
  company?: { id?: string; wallet?: string; email?: string; name?: string; traits?: Record<string, unknown> };
  user?: { id?: string; clerkUserId?: string; wallet?: string; email?: string; name?: string };
}

/** @alias MEAPProviderProps */
export type ArcenPayProviderProps = MEAPProviderProps;

/**
 * MEAPProvider — Root provider for MEAP protocol integration.
 * Sets up Wagmi wallet connection, React Query, and protocol context.
 */
export function MEAPProvider(props: MEAPProviderProps) {
  const {
    children,
    config: userConfig,
    chainId = DEFAULT_CHAIN_ID,
    walletConnectProjectId,
  } = props;
  const wagmiConfig = useMemo(() => {
    const projectId =
      walletConnectProjectId ||
      (typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "")
        : "");

    // Allow per-chain RPC URL overrides via env vars:
    // NEXT_PUBLIC_RPC_URL_<chainId> takes precedence, then NEXT_PUBLIC_RPC_URL as a global fallback.
    const getRpcTransport = (id: number) => {
      const specific =
        typeof process !== "undefined"
          ? process.env[`NEXT_PUBLIC_RPC_URL_${id}`]
          : undefined;
      const global_ =
        typeof process !== "undefined"
          ? process.env.NEXT_PUBLIC_RPC_URL
          : undefined;
      const manifestRpc = getChainEnvironment(id).services.rpcUrl;
      const url = specific ?? global_ ?? manifestRpc;
      return url ? http(url) : http();
    };

    return createConfig({
      chains: [sepolia, baseSepolia, base],
      connectors: projectId
        ? [injected(), walletConnect({ projectId })]
        : [injected()],
      transports: {
        [sepolia.id]: getRpcTransport(sepolia.id),
        [baseSepolia.id]: getRpcTransport(baseSepolia.id),
        [base.id]: getRpcTransport(base.id),
      },
      ssr: true,
    });
  }, [walletConnectProjectId]);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, gcTime: 5 * 60 * 1000 },
        },
      }),
  );

  const [sessionCtx, setSessionCtx] = useState<ArcenSessionContextValue>({
    token: props.token ?? null,
    companyId: null,
    userId: null,
    isReady: !!props.token,
    identify: async () => {
      throw new Error("Arcen session provider is not ready");
    },
  });

  const { apiKey, token: tokenProp, company, user } = props;
  const companyFingerprint = JSON.stringify(company ?? null);
  const userFingerprint = JSON.stringify(user ?? null);

  const identify = React.useCallback(
    async (input: ArcenIdentifyInput): Promise<ArcenIdentifyResult> => {
      if (!apiKey) {
        throw new Error("apiKey is required to create an Arcen session");
      }

      const baseUrl = resolveDashboardBaseUrl();
      const response = await fetch(`${baseUrl}/api/v1/access-tokens`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          company: input.company,
          user: input.user
            ? {
                id: input.user.id,
                clerk_user_id: input.user.clerkUserId,
                wallet: input.user.wallet,
                email: input.user.email,
                name: input.user.name,
              }
            : undefined,
          expires_in: input.expiresIn ?? 3600,
        }),
      });

      const json = (await response.json()) as {
        error?: string;
        data?: { token: string; company_id: string; user_id?: string };
      };

      if (!response.ok || !json.data?.token) {
        throw new Error(json.error ?? "Failed to identify session");
      }

      const nextSession = {
        token: json.data.token,
        companyId: json.data.company_id,
        userId: json.data.user_id ?? null,
        isReady: true,
      };

      setSessionCtx((current) => ({
        ...current,
        ...nextSession,
        identify: current.identify,
      }));

      return {
        token: nextSession.token,
        companyId: nextSession.companyId,
        userId: nextSession.userId,
      };
    },
    [apiKey],
  );

  useEffect(() => {
    if (tokenProp) {
      setSessionCtx((current) => ({
        ...current,
        token: tokenProp,
        companyId: null,
        userId: null,
        isReady: true,
      }));
    }
  }, [tokenProp]);

  useEffect(() => {
    if (tokenProp || !apiKey || (!company && !user)) return;

    void identify({
      company,
      user,
      expiresIn: 3600,
    }).catch((err) => console.error("[ArcenPayProvider] identify failed:", err));
  }, [apiKey, tokenProp, companyFingerprint, userFingerprint, identify]);

  useEffect(() => {
    setSessionCtx((current) => ({
      ...current,
      identify,
    }));
  }, [identify]);

  const contextValue = useMemo<MEAPContextValue>(() => {
    if (typeof process !== "undefined" && process.env.NODE_ENV === "production") {
      validateChainEnvironment(chainId, {
        production: true,
        requiredServices: ["rpcUrl"],
      });
    }

    const manifest = getChainEnvironment(chainId);
    const contracts = manifest.contracts;

    const network: NetworkConfig = {
      chainId,
      name: manifest.chainName,
      rpcUrl: manifest.services.rpcUrl,
      contracts,
    };

    const litNetwork: MEAPConfig["litNetwork"] =
      userConfig?.litNetwork ??
      ((typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_LIT_NETWORK
        : undefined) as MEAPConfig["litNetwork"] | undefined) ??
      "manzano";

    const config: MEAPConfig = {
      ...userConfig,
      network,
      litNetwork,
      tablelandConfig: {
        providerUrl:
          userConfig?.tablelandConfig?.providerUrl ??
          manifest.services.facilitatorUrl,
        featureFlagsEndpoint: userConfig?.tablelandConfig?.featureFlagsEndpoint,
      },
    };

    return {
      config,
      contracts,
      network,
      isTestnet: manifest.isTestnet,
    };
  }, [chainId, userConfig]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MEAPContext.Provider value={contextValue}>
          <ArcenSessionContext.Provider value={sessionCtx}>
            {children}
          </ArcenSessionContext.Provider>
        </MEAPContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

/**
 * Hook to access MEAP protocol context
 */
export function useMEAP(): MEAPContextValue {
  const context = useContext(MEAPContext);
  if (!context) {
    throw new Error("useArcenPay must be used within an ArcenPayProvider");
  }
  return context;
}

/** @alias MEAPProvider — ArcenPay-branded alias */
export const ArcenPayProvider = MEAPProvider;

/** @alias useMEAP — ArcenPay-branded alias */
export const useArcenPay = useMEAP;
