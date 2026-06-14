"use client";

import { useState, useEffect } from "react";
import { useAccount, useChainId } from "wagmi";
import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/dashboard/charts/revenue-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { useEnvironment } from "@/contexts/environment-context";
import {
  DollarSign,
  Users,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { formatUsdc } from "@/lib/format";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";

type OverviewPayload = {
  context: {
    teamId: string;
    environmentMode: "DEVELOPMENT" | "PRODUCTION";
    chainId: number;
  };
  metrics: {
    activePlans: number;
    activeSubscribers: number;
    paidInvoiceRevenue30dRaw: string;
  };
};

export function OverviewSection() {
  const { isConnected } = useAccount();
  const walletChainId = useChainId();
  const { envMode, activeEnvironment, isLoading: envLoading } = useEnvironment();
  const [mounted, setMounted] = useState(false);
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  const effectiveChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const environmentKey = activeEnvironment?.id ?? envMode;

  useEffect(() => {
    if (!mounted || envLoading) return;

    let cancelled = false;

    async function loadOverview() {
      try {
        setIsLoading(true);
        const params = new URLSearchParams({
          chainId: String(effectiveChainId),
          environmentMode: envMode,
        });
        const res = await fetch(`/api/platform/overview?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setPayload(null);
          return;
        }
        const data = (await res.json()) as OverviewPayload;
        if (!cancelled) setPayload(data);
      } catch {
        if (!cancelled) setPayload(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadOverview();
    const interval = setInterval(() => {
      void loadOverview();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mounted, envLoading, envMode, effectiveChainId, environmentKey]);

  const metrics = {
    activeSubscribers:
      payload?.metrics.activeSubscribers != null
        ? String(payload.metrics.activeSubscribers)
        : "—",
    paidInvoiceRevenue30d:
      payload?.metrics.paidInvoiceRevenue30dRaw != null
        ? formatUsdc(payload.metrics.paidInvoiceRevenue30dRaw)
        : "—",
    activePlans:
      payload?.metrics.activePlans != null
        ? String(payload.metrics.activePlans)
        : "—",
  };

  return (
    <div className="space-y-6">
      {/* Wallet disconnected banner */}
      {mounted && !isConnected && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary border border-border">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            Wallet disconnected — showing data for {getChainLabel(effectiveChainId)}.
          </p>
        </div>
      )}
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard
          title="Active Subscribers"
          value={mounted ? metrics.activeSubscribers : "—"}
          changeType="neutral"
          icon={Users}
          delay={0}
          loading={mounted && (isLoading || envLoading)}
        />
        <MetricCard
          title="Paid Invoice Revenue (30d)"
          value={mounted ? metrics.paidInvoiceRevenue30d : "—"}
          changeType="neutral"
          icon={DollarSign}
          delay={1}
          loading={mounted && (isLoading || envLoading)}
        />
        <MetricCard
          title="Active Plans"
          value={mounted ? metrics.activePlans : "—"}
          changeType="neutral"
          icon={Layers}
          delay={2}
          loading={mounted && (isLoading || envLoading)}
        />
      </div>

      {/* Chart + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <RevenueChart
            chainId={effectiveChainId}
            environmentKey={environmentKey}
          />
        </div>
        <RecentActivity
          chainId={effectiveChainId}
          environmentKey={environmentKey}
        />
      </div>
    </div>
  );
}
