"use client";

import { useCallback, useEffect, useState } from "react";

export type DashboardSessionPayload = {
  user: {
    id: string;
    email: string | null;
    walletAddress: string | null;
  };
  currentTeam: {
    id: string;
    name: string;
    slug: string;
    role: string;
  } | null;
  teams: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
};

export function useDashboardSession() {
  const [data, setData] = useState<DashboardSessionPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        setData(null);
        return null;
      }
      const payload = (await response.json()) as DashboardSessionPayload;
      setData(payload);
      return payload;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    data,
    isLoading,
    refresh,
  };
}
