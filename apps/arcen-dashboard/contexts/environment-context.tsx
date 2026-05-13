'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { normalizeEnvironmentMode } from '@/lib/default-chain';

export type EnvMode = 'DEVELOPMENT' | 'PRODUCTION';

interface EnvironmentContextType {
  envMode: EnvMode;
  setEnvMode: (mode: EnvMode) => void;
  isLoading: boolean;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(
  undefined,
);

export function EnvironmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [envMode, setEnvMode] = useState<EnvMode>("DEVELOPMENT");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // The workspace environment is a team-level setting. Keep it sourced from
    // the backend so manual environment switches are not overwritten by the
    // currently connected wallet network.
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.environmentMode) {
          setEnvMode(normalizeEnvironmentMode(data.environmentMode));
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

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
