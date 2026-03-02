"use client";

import { useEffect, useState } from "react";
import { ApolloClient, InMemoryCache, gql } from "@apollo/client";

interface ProtocolStats {
  totalSubscriptions: number;
  totalRevenue: string;
  totalPlans: number;
}

const GRAPH_URL = process.env.NEXT_PUBLIC_GRAPH_URL ?? "";

async function fetchStats(): Promise<ProtocolStats | null> {
  if (!GRAPH_URL) return null;
  try {
    const client = new ApolloClient({ uri: GRAPH_URL, cache: new InMemoryCache() });
    const { data } = await client.query({
      query: gql`query { protocolStats(id: "global") { totalSubscriptions totalRevenue totalPlans } }`,
    });
    return data?.protocolStats ?? null;
  } catch {
    return null;
  }
}

const FALLBACK_STATS = [
  { label: "Active Subscriptions", value: "—" },
  { label: "Total Revenue", value: "—" },
  { label: "Plans Deployed", value: "—" },
  { label: "Network", value: "Sepolia" },
];

export function StatsBar() {
  const [stats, setStats] = useState<typeof FALLBACK_STATS>(FALLBACK_STATS);

  useEffect(() => {
    fetchStats().then((data) => {
      if (!data) return;
      setStats([
        { label: "Active Subscriptions", value: data.totalSubscriptions.toString() },
        { label: "Total Revenue", value: `$${(parseInt(data.totalRevenue) / 1e6).toLocaleString()}` },
        { label: "Plans Deployed", value: data.totalPlans.toString() },
        { label: "Network", value: "Sepolia" },
      ]);
    });
  }, []);

  return (
    <section className="py-16 px-6 border-y border-zinc-800">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl font-bold text-white mb-1">{stat.value}</p>
              <p className="text-sm text-zinc-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
