"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { BarChart3 } from "lucide-react";

type ProofHistoryJob = {
  label: string;
  revenueRaw: string;
};

type RevenuePoint = {
  time: string;
  revenue: number;
};

interface RevenueChartProps {
  chainId: number;
  environmentKey: string;
}

export function RevenueChart({ chainId, environmentKey }: RevenueChartProps) {
  const [data, setData] = useState<RevenuePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchRevenue = async () => {
      try {
        setLoading(true);
        const response = await fetch(
          `/api/platform/revenue-series?months=12`,
        );
        if (!response.ok) return;
        const payload = await response.json();
        const jobs = Array.isArray(payload.points)
          ? (payload.points as ProofHistoryJob[])
          : [];
        const points = jobs.map((job) => ({
          time: job.label,
          revenue: Number(job.revenueRaw) / 1e6,
        }));

        if (!cancelled) {
          setData(points);
        }
      } catch {
        if (!cancelled) {
          setData([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchRevenue();
    const interval = setInterval(() => {
      void fetchRevenue();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chainId, environmentKey]);

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">Paid Invoice Revenue</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Last 12 months of paid invoice revenue
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-chart-1" />
            <span className="text-muted-foreground">Revenue</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-[280px] text-center">
          <p className="text-sm text-muted-foreground">Loading revenue trend...</p>
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-[280px] text-center">
          <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
            <BarChart3 className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">No revenue data yet</p>
          <p className="text-xs text-muted-foreground max-w-[280px]">
            Revenue will populate once paid invoices are recorded for this workspace
          </p>
        </div>
      ) : (
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(value) => `$${Number(value).toFixed(2)}`}
              />
              <Tooltip
                formatter={(value: number) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="hsl(var(--chart-1))"
                fill="hsl(var(--chart-1) / 0.2)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
