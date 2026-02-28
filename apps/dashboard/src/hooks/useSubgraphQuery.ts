// ============================================================
//  Dashboard — Subgraph Query Hook
//  React hook for executing GraphQL queries against the
//  deployed subgraph endpoint.
// ============================================================

"use client";

import { useState, useEffect, useCallback } from "react";

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || "";

interface UseSubgraphQueryOptions<T> {
  query: string;
  variables?: Record<string, unknown>;
  /** If false, the query will not execute */
  enabled?: boolean;
  /** Transform the raw data */
  select?: (data: Record<string, unknown>) => T;
}

interface UseSubgraphQueryResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useSubgraphQuery<T = Record<string, unknown>>(
  options: UseSubgraphQueryOptions<T>,
): UseSubgraphQueryResult<T> {
  const { query, variables, enabled = true, select } = options;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchData = useCallback(async () => {
    if (!SUBGRAPH_URL) {
      setError(new Error("Subgraph URL not configured"));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(SUBGRAPH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`Subgraph query failed: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.errors?.length > 0) {
        throw new Error(result.errors[0].message);
      }

      const transformed = select ? select(result.data) : (result.data as T);
      setData(transformed);
    } catch (err: any) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [query, variables, select]);

  useEffect(() => {
    if (enabled) {
      fetchData();
    }
  }, [enabled, fetchData]);

  return { data, loading, error, refetch: fetchData };
}

// ============================================================
//  Pre-built Queries
// ============================================================

export const SUBSCRIBER_GROWTH_QUERY = `
    query SubscriberGrowth($first: Int = 100) {
        subscriptions(first: $first, orderBy: createdAt, orderDirection: desc) {
            id
            subscriber
            planId
            expiration
            createdAt
        }
    }
`;

export const SUBSCRIPTION_STATS_QUERY = `
    query SubscriptionStats {
        subscriptionStats(id: "global") {
            totalSubscriptions
            activeSubscriptions
            totalRevenue
        }
    }
`;
