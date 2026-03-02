"use client";

import { MetricCard } from "@/components/dashboard/metric-card";
import { RevenueChart } from "@/components/dashboard/charts/revenue-chart";
import { RecentActivity } from "@/components/dashboard/recent-activity";
import { DollarSign, Users, Layers, Receipt } from "lucide-react";

export function OverviewSection() {
  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Subscribers"
          value="0"
          changeType="neutral"
          icon={Users}
          delay={0}
        />
        <MetricCard
          title="Monthly Recurring Revenue"
          value="$0.00"
          changeType="neutral"
          icon={DollarSign}
          delay={1}
        />
        <MetricCard
          title="Protocol Fees Paid"
          value="$0.00"
          changeType="neutral"
          icon={Receipt}
          delay={2}
        />
        <MetricCard
          title="Active Plans"
          value="0"
          changeType="neutral"
          icon={Layers}
          delay={3}
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
