"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  delay?: number;
  loading?: boolean;
}

export function MetricCard({
  title,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  delay = 0,
  loading = false,
}: MetricCardProps) {
  return (
    <div
      className="group bg-card border border-border rounded-xl p-5 transition-colors duration-200 hover:border-[#333333]"
      style={{ animationDelay: `${delay * 100}ms`, animationFillMode: "both" }}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm text-muted-foreground font-medium">
          {title}
        </span>
        <div className="w-9 h-9 rounded-lg bg-surface border border-border flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>

      <div className="flex items-end gap-3">
        {loading ? (
          <div className="h-8 w-24 bg-surface rounded-md animate-pulse" />
        ) : (
          <span className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
            {value}
          </span>
        )}
        {change && (
          <div
            className={cn(
              "flex items-center gap-1 text-sm font-medium mb-1",
              changeType === "positive" && "text-success",
              changeType === "negative" && "text-destructive",
              changeType === "neutral" && "text-muted-foreground"
            )}
          >
            {changeType === "positive" && <TrendingUp className="w-3.5 h-3.5" />}
            {changeType === "negative" && (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            <span>{change}</span>
          </div>
        )}
      </div>
    </div>
  );
}
