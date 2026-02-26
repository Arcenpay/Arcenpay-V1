"use client";

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { sepolia, baseSepolia, base } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MEAPConfig, ContractAddresses, NetworkConfig } from "@meap/core";
import {
  getContractAddresses,
  DEFAULT_CHAIN_ID,
  baseSepolia as meapBaseSepolia,
  baseMainnet as meapBaseMainnet,
  sepolia as meapSepolia,
} from "@meap/core";

// ============================================================
//  MEAPProvider — Root Context Provider
//  Wraps application with Wagmi + React Query + protocol config
// ============================================================

interface MEAPContextValue {
  config: MEAPConfig;
  contracts: ContractAddresses;
  network: NetworkConfig;
  isTestnet: boolean;
}

const MEAPContext = createContext<MEAPContextValue | null>(null);

interface MEAPProviderProps {
  children: ReactNode;
  config?: Partial<MEAPConfig>;
  chainId?: number;
  walletConnectProjectId?: string;
}

/**
 * MEAPProvider — Root provider for MEAP protocol integration.
 * Sets up Wagmi wallet connection, React Query, and protocol context.
 */
export function MEAPProvider({
  children,
  config: userConfig,
  chainId = DEFAULT_CHAIN_ID,
  walletConnectProjectId,
}: MEAPProviderProps) {
  const wagmiConfig = useMemo(() => {
    const projectId =
      walletConnectProjectId ||
      (typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "")
        : "");

    return createConfig({
      chains: [sepolia, baseSepolia, base],
      connectors: projectId
        ? [injected(), walletConnect({ projectId })]
        : [injected()],
      transports: {
        [sepolia.id]: http(),
        [baseSepolia.id]: http(),
        [base.id]: http(),
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

  const contextValue = useMemo<MEAPContextValue>(() => {
    const chain =
      chainId === 8453
        ? meapBaseMainnet
        : chainId === 11155111
          ? meapSepolia
          : meapBaseSepolia;
    const contracts = getContractAddresses(chainId as any);

    const network: NetworkConfig = {
      chainId,
      name: chain.name,
      rpcUrl: chain.rpcUrls.default.http[0],
      contracts,
    };

    const config: MEAPConfig = {
      network,
      litNetwork: userConfig?.litNetwork ?? "manzano",
      ...userConfig,
    };

    return {
      config,
      contracts,
      network,
      isTestnet: chainId !== 8453,
    };
  }, [chainId, userConfig]);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MEAPContext.Provider value={contextValue}>
          {children}
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
    throw new Error("useMEAP must be used within a MEAPProvider");
  }
  return context;
}
