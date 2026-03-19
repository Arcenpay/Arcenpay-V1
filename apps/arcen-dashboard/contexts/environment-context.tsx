"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useAppKitNetwork } from "@reown/appkit/react";

export type EnvMode = "DEVELOPMENT" | "PRODUCTION";

interface EnvironmentContextType {
  envMode: EnvMode;
  setEnvMode: (mode: EnvMode) => void;
  isLoading: boolean;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(
  undefined,
);

// Map of chain IDs to their environment
const TESTNET_CHAINS = [11155111, 84532]; // sepolia, baseSepolia
const MAINNET_CHAINS = [1, 8453]; // mainnet, base

function getEnvModeFromChainId(chainId: number | undefined): EnvMode | null {
  if (!chainId) return null;
  if (TESTNET_CHAINS.includes(chainId)) return "DEVELOPMENT";
  if (MAINNET_CHAINS.includes(chainId)) return "PRODUCTION";
  return null;
}

export function EnvironmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [envMode, setEnvMode] = useState<EnvMode>("DEVELOPMENT");
  const [isLoading, setIsLoading] = useState(true);
  const { chainId } = useAppKitNetwork();

  useEffect(() => {
    // Fetch the current environment mode from the team settings
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.environmentMode) {
          setEnvMode(data.environmentMode as EnvMode);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  // Auto-sync environment when network changes
  useEffect(() => {
    if (isLoading || !chainId) return;

    const newEnvMode = getEnvModeFromChainId(chainId);
    if (newEnvMode && newEnvMode !== envMode) {
      setEnvMode(newEnvMode);

      // Sync with backend
      fetch("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentMode: newEnvMode }),
      }).catch((err) => {
        console.error("Failed to sync environment mode:", err);
      });
    }
  }, [chainId, envMode, isLoading]);

  return (
    <EnvironmentContext.Provider value={{ envMode, setEnvMode, isLoading }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error(
      "useEnvironment must be used within an EnvironmentProvider",
    );
  }
  return context;
}
