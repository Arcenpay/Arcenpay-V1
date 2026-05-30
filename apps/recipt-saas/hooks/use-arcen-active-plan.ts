"use client";

import type { ComponentRenderData } from "@arcenpay/react";
import { useArcenPay } from "@arcenpay/react";
import { useCallback, useEffect, useRef, useState } from "react";

type ActivePlan = ComponentRenderData["activePlan"];

type UseArcenActivePlanOptions = {
  skip?: boolean;
};

export function useArcenActivePlan(
  options: UseArcenActivePlanOptions = {},
) {
  const { baseUrl, componentId, session } = useArcenPay();
  const abortRef = useRef<AbortController | null>(null);
  const [activePlan, setActivePlan] = useState<ActivePlan>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchActivePlan = useCallback(async () => {
    if (options.skip || !session.token || !componentId) {
      setActivePlan(null);
      setLoading(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${baseUrl}/api/v1/components/${componentId}/render`,
        {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          detail?: string;
          error?: string;
          message?: string;
        };
        throw new Error(
          payload.detail ??
            payload.error ??
            payload.message ??
            `HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as {
        data?: ComponentRenderData;
      };

      setActivePlan(payload.data?.activePlan ?? null);
    } catch (cause) {
      if ((cause as Error).name === "AbortError") {
        return;
      }

      setActivePlan(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Failed to fetch active billing plan.",
      );
    } finally {
      setLoading(false);
    }
  }, [baseUrl, componentId, options.skip, session.token]);

  useEffect(() => {
    void fetchActivePlan();

    return () => {
      abortRef.current?.abort();
    };
  }, [fetchActivePlan]);

  return {
    activePlan,
    error,
    loading,
    refetch: fetchActivePlan,
  };
}
