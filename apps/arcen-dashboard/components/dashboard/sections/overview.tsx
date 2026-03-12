"use client";

import { useState, useEffect } from "react";
import { useAccount, useChainId, useReadContracts } from "wagmi";
import { useQuery } from "@apollo/client";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/dashboard/charts/revenue-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import {
  DollarSign,
  Users,
  Layers,
  Receipt,
  AlertTriangle,
} from "lucide-react";
import {
  useContractAddresses,
  FeeCollectorABI,
  SEPOLIA_USDC,
} from "@/lib/contracts";
import { GET_PROTOCOL_STATS } from "@/lib/graphql";
import { formatUsdc } from "@/lib/format";

export function OverviewSection() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const [mounted, setMounted] = useState(false);

  // DB-sourced metrics (primary source — reliable, instant)
  const [dbActivePlans, setDbActivePlans] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load active plans count from the catalog DB API on mount
  useEffect(() => {
    async function loadDbMetrics() {
      try {
        const res = await fetch("/api/catalog/plans");
        if (res.ok) {
          const data = await res.json();
          const plans: Array<{ active: boolean; status: string }> =
            data.plans ?? [];
          const activeCount = plans.filter(
            (p) => p.active && p.status !== "ARCHIVED",
          ).length;
          setDbActivePlans(activeCount);
        }
      } catch {
        // non-critical — fall back to on-chain read
      }
    }
    loadDbMetrics();
  }, []);

  const contractAddresses = useContractAddresses();

  // Batch on-chain reads (fees + plan IDs as fallback)
  const { data: contractData, isLoading: contractsLoading } = useReadContracts(
    {
      contracts: [
        {
          address: contractAddresses.feeCollector as `0x${string}`,
          abi: FeeCollectorABI,
          functionName: "accumulatedFees",
          args: [SEPOLIA_USDC as `0x${string}`],
          chainId,
        },
      ],
      query: { enabled: mounted && isConnected && !!address },
    },
  );

  // The Graph for subscriber + revenue stats
  const { data: graphData, loading: graphLoading } = useQuery(
    GET_PROTOCOL_STATS,
    {
      skip: !mounted || !isConnected,
    },
  );

  const isLoading = contractsLoading || graphLoading;

  const feesCollected = contractData?.[0]?.result as bigint | undefined;
  const stats = graphData?.protocolStats;

  const metrics = {
    activeSubscribers: stats?.activeSubscriptions?.toString() ?? "—",
    mrr:
      stats?.totalRevenue != null
        ? formatUsdc(BigInt(stats.totalRevenue))
        : "—",
    feesCollected: feesCollected != null ? formatUsdc(feesCollected) : "—",
    // DB count is authoritative; will show immediately without wallet/chain dependency
    activePlans: dbActivePlans != null ? String(dbActivePlans) : "—",
  };

  return (
    <div className="space-y-6">
      {/* Wallet disconnected banner */}
      {mounted && !isConnected && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-top-2 duration-300">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            Connect your wallet to load live dashboard data.
          </p>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Subscribers"
          value={mounted && isConnected ? metrics.activeSubscribers : "—"}
          changeType="neutral"
          icon={Users}
          delay={0}
          loading={mounted && isLoading && isConnected}
        />
        <MetricCard
          title="Monthly Recurring Revenue"
          value={mounted && isConnected ? metrics.mrr : "—"}
          changeType="neutral"
          icon={DollarSign}
          delay={1}
          loading={mounted && isLoading && isConnected}
        />
        <MetricCard
          title="Protocol Fees Collected"
          value={mounted && isConnected ? metrics.feesCollected : "—"}
          changeType="neutral"
          icon={Receipt}
          delay={2}
          loading={mounted && isLoading && isConnected}
        />
        <MetricCard
          title="Active Plans"
          value={mounted ? metrics.activePlans : "—"}
          changeType="neutral"
          icon={Layers}
          delay={3}
          loading={mounted && dbActivePlans === null}
        />
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>
        <RecentActivity />
      </div>
    </div>
  );
}
