"use client";

import { useEffect, useState } from "react";
import { Activity, Zap, Receipt, ArrowUpRight } from "lucide-react";

type ActivityItem = {
  id: string;
  type: "subscription" | "payment" | "settlement" | "invoice";
  description: string;
  amount?: string;
  timestamp: number;
  status?: string;
};

interface RecentActivityProps {
  chainId: number;
  environmentKey: string;
}

export function RecentActivity({ chainId, environmentKey }: RecentActivityProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchActivity = async () => {
      try {
        setLoading(true);
        // Try the unified activity feed first; fall back to proof history
        const res = await fetch(`/api/platform/activity?limit=6&chainId=${chainId}`);
        if (res.ok) {
          const payload = await res.json();
          if (!cancelled) {
            setItems(Array.isArray(payload.items) ? payload.items : []);
          }
          return;
        }
        // Fallback to proof history endpoint for older deployments
        const fallback = await fetch(`/api/proofs/history?limit=6&chainId=${chainId}`);
        if (!fallback.ok) {
          if (!cancelled) setItems([]);
          return;
        }
        const data = await fallback.json();
        if (!cancelled) {
          const jobs = Array.isArray(data.jobs) ? data.jobs : [];
          setItems(
            jobs.map((job: unknown) => {
              const j = job as {
                sessionId?: string;
                status?: string;
                settlementAmount?: string;
                createdAt?: number;
                txHash?: string;
              };
              return {
                id: j.sessionId ?? "unknown",
                type: "settlement" as const,
                description: j.status === "submitted" ? "Settlement submitted" : "Proof job updated",
                amount: j.settlementAmount,
                timestamp: j.createdAt ?? Date.now(),
                status: j.status,
              };
            }),
          );
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchActivity();
    const interval = setInterval(() => void fetchActivity(), 30_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [chainId, environmentKey]);

  const typeIcon = (type: ActivityItem["type"]) => {
    switch (type) {
      case "subscription":
        return <Zap className="w-3.5 h-3.5" />;
      case "payment":
        return <Receipt className="w-3.5 h-3.5" />;
      case "invoice":
        return <Receipt className="w-3.5 h-3.5" />;
      default:
        return <Activity className="w-3.5 h-3.5" />;
    }
  };

  const typeLabel = (type: ActivityItem["type"]) => {
    switch (type) {
      case "subscription":
        return "Subscription";
      case "payment":
        return "Payment";
      case "invoice":
        return "Invoice";
      default:
        return "Settlement";
    }
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Recent Activity</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Latest events across your workspace
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-surface/50 px-4 py-3">
              <div className="w-8 h-8 rounded-lg bg-surface animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-32 bg-surface rounded animate-pulse" />
                <div className="h-2.5 w-20 bg-surface rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center mb-3">
            <Activity className="w-5 h-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground mb-0.5">No activity yet</p>
          <p className="text-xs text-muted-foreground max-w-[260px]">
            Subscriptions, payments, and settlements will appear here as they happen
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-3 rounded-xl border border-border bg-surface/40 hover:bg-surface px-4 py-3 transition-colors cursor-default"
            >
              <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center text-muted-foreground shrink-0 group-hover:border-muted-foreground/20 transition-colors">
                {typeIcon(item.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground truncate">
                    {item.description}
                  </p>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-card border border-border px-1.5 py-0.5 rounded shrink-0">
                    {typeLabel(item.type)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {new Date(item.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              {item.amount && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-medium text-foreground">
                    ${(Number(item.amount) / 1e6).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
