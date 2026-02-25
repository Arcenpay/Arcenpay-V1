'use client';

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { MEAPConfig, ContractAddresses, NetworkConfig } from '@meap/core';
import {
  getContractAddresses,
  DEFAULT_CHAIN_ID,
  baseSepolia,
  baseMainnet,
} from '@meap/core';

// ============================================================
//  MEAPProvider — Root Context Provider
//  Wraps application with protocol configuration
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
  planRegistryAddress?: string;
  chainId?: number;
}

/**
 * MEAPProvider — Root provider for MEAP protocol integration
 *
 * @example
 * ```tsx
 * import { MEAPProvider } from '@meap/react';
 *
 * function App() {
 *   return (
 *     <MEAPProvider chainId={84532}>
 *       <YourApp />
 *     </MEAPProvider>
 *   );
 * }
 * ```
 */
export function MEAPProvider({
  children,
  config: userConfig,
  chainId = DEFAULT_CHAIN_ID,
}: MEAPProviderProps) {
  const contextValue = useMemo<MEAPContextValue>(() => {
    const chain = chainId === 8453 ? baseMainnet : baseSepolia;
    const contracts = getContractAddresses(chainId as any);

    const network: NetworkConfig = {
      chainId,
      name: chain.name,
      rpcUrl: chain.rpcUrls.default.http[0],
      contracts,
    };

    const config: MEAPConfig = {
      network,
      litNetwork: userConfig?.litNetwork ?? 'manzano',
      ...userConfig,
    };

    return {
      config,
      contracts,
      network,
      isTestnet: chainId === 84532,
    };
  }, [chainId, userConfig]);

  return (
    <MEAPContext.Provider value={contextValue}>
      {children}
    </MEAPContext.Provider>
  );
}

/**
 * Hook to access MEAP protocol context
 */
export function useMEAP(): MEAPContextValue {
  const context = useContext(MEAPContext);
  if (!context) {
    throw new Error('useMEAP must be used within a MEAPProvider');
  }
  return context;
}
