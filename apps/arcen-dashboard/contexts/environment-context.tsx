"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type EnvMode = "DEVELOPMENT" | "PRODUCTION";

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
