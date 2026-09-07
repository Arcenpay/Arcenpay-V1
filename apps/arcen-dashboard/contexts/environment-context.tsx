'use client';
import { apiFetch } from "@/lib/api-client";
import { useRouter } from "next/navigation";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useDashboardSession, type DashboardSessionPayload } from '@/hooks/use-dashboard-session';

export type EnvMode = 'DEVELOPMENT' | 'PRODUCTION';

export type WorkspaceEnvironmentSummary = NonNullable<
  DashboardSessionPayload['activeEnvironment']
>;

type EnvironmentContextType = {
  envMode: EnvMode;
  activeEnvironment: WorkspaceEnvironmentSummary | null;
  environments: WorkspaceEnvironmentSummary[];
  environmentLimits: { development: number; production: number } | null;
  environmentCounts: { development: number; production: number } | null;
  isLoading: boolean;
  selectEnvironment: (environmentId: string) => Promise<boolean>;
  setEnvMode: (mode: EnvMode) => Promise<boolean>;
  refreshEnvironments: () => Promise<void>;
};

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(
  undefined,
);

export function EnvironmentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: sessionData, isLoading: sessionLoading, refresh } = useDashboardSession();
  const [environmentLimits, setEnvironmentLimits] = useState<{
    development: number;
    production: number;
  } | null>(null);
  const [environmentCounts, setEnvironmentCounts] = useState<{
    development: number;
    production: number;
  } | null>(null);

  const fetchEnvironmentMeta = useCallback(async () => {
    try {
      const res = await apiFetch('/api/environments', {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const payload = (await res.json()) as {
        limits?: { development: number; production: number };
        counts?: { development: number; production: number };
      };
      if (payload.limits) setEnvironmentLimits(payload.limits);
      if (payload.counts) setEnvironmentCounts(payload.counts);
    } catch {
      // Best-effort metadata only.
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading) {
      void fetchEnvironmentMeta();
    }
  }, [fetchEnvironmentMeta, sessionLoading]);

  const refreshEnvironments = useCallback(async () => {
    await refresh();
    await fetchEnvironmentMeta();
  }, [fetchEnvironmentMeta, refresh]);

  const selectEnvironment = useCallback(
    async (environmentId: string) => {
      const response = await apiFetch('/api/environments/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ environmentId }),
      });
      if (!response.ok) return false;
      await refreshEnvironments();
      return true;
    },
    [refreshEnvironments],
  );

  const activeEnvironment = sessionData?.activeEnvironment ?? null;
  const environments = sessionData?.environments ?? [];
  const envMode = activeEnvironment?.mode ?? 'DEVELOPMENT';

  // A workspace that loads with no environment must not be dumped onto a
  // dashboard that will 409 on every billing route. Send the user to the
  // environment-creation screen so they explicitly pick their chain first.
  useEffect(() => {
    if (sessionLoading) return;
    if (!sessionData) return;
    if (sessionData.environments.length === 0 && !sessionData.activeEnvironment) {
      router.replace('/onboarding/environment');
    }
  }, [sessionLoading, sessionData, router]);

  const setEnvMode = useCallback(
    async (mode: EnvMode) => {
      const target = environments.find((environment) => environment.mode === mode);
      if (!target) return false;
      return selectEnvironment(target.id);
    },
    [environments, selectEnvironment],
  );

  const value = useMemo(
    () => ({
      envMode,
      activeEnvironment,
      environments,
      environmentLimits,
      environmentCounts,
      isLoading: sessionLoading,
      selectEnvironment,
      setEnvMode,
      refreshEnvironments,
    }),
    [
      activeEnvironment,
      envMode,
      environmentCounts,
      environmentLimits,
      environments,
      refreshEnvironments,
      selectEnvironment,
      sessionLoading,
      setEnvMode,
    ],
  );

  return (
    <EnvironmentContext.Provider value={value}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error(
      'useEnvironment must be used within an EnvironmentProvider',
    );
  }
  return context;
}
