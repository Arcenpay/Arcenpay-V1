"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, XCircle, X, RefreshCw } from "lucide-react";
import { checkSubgraphHealth, type SubgraphHealth } from "@/lib/graphql";

const DEGRADED_LAG_SECONDS = 60;
const UNHEALTHY_LAG_SECONDS = 300;
const POLL_INTERVAL_MS = 60_000; // re-check every minute

export function SubgraphLagBanner() {
  const [health, setHealth] = useState<SubgraphHealth | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    const result = await checkSubgraphHealth();
    setHealth(result);
    setLastChecked(new Date());
    // Auto-un-dismiss if the problem clears
    if (result.healthy && (result.lagSeconds ?? 0) < DEGRADED_LAG_SECONDS) {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const id = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check]);

  if (!health || dismissed) return null;

  const lag = health.lagSeconds ?? 0;
  const isUnhealthy = !health.healthy || lag >= UNHEALTHY_LAG_SECONDS;
  const isDegraded = !isUnhealthy && lag >= DEGRADED_LAG_SECONDS;

  if (!isUnhealthy && !isDegraded && !health.error) return null;

  const Icon = isUnhealthy ? XCircle : AlertTriangle;
  const bgColor = isUnhealthy
    ? "bg-destructive/10 border-destructive/30 text-destructive"
    : "bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400";

  const message = health.error
    ? `Subgraph unreachable: ${health.error}`
    : isUnhealthy
    ? `Subgraph is ${lag}s behind chain tip — data may be significantly stale`
    : `Subgraph is ${lag}s behind chain tip — some data may be delayed`;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 text-sm border-b ${bgColor}`}
      role="alert"
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {lastChecked && (
        <span className="text-xs opacity-60">
          checked {lastChecked.toLocaleTimeString()}
        </span>
      )}
      <button
        onClick={() => void check()}
        className="opacity-60 hover:opacity-100 transition-opacity"
        title="Refresh subgraph status"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="opacity-60 hover:opacity-100 transition-opacity"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
