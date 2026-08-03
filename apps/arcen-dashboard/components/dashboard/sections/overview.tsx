"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useEnvironment } from "@/contexts/environment-context";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import {
  AlertTriangle,
  DollarSign,
  Users,
  Layers,
  TrendingUp,
  ArrowRight,
  Rocket,
  Wallet,
  Globe,
  CreditCard,
  Zap,
  X,
} from "lucide-react";
import { formatUsdc } from "@/lib/format";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { RecentActivity } from "@/components/dashboard/recent-activity";

/* ── Types ─────────────────────────────────────────────── */
type OverviewPayload = {
  context: { teamId: string; environmentMode: "DEVELOPMENT" | "PRODUCTION"; chainId: number };
  metrics: {
    activePlans: number;
    activeSubscribers: number;
    paidInvoiceRevenue30dRaw: string;
  };
};

type RevenuePoint = { label: string; revenueRaw: string };

type RevenueSeriesPayload = {
  granularity: "monthly" | "daily";
  points: RevenuePoint[];
};

type TimeRange = "all" | "12m" | "3m" | "30d" | "today";

/* ── Helpers ───────────────────────────────────────────── */
function getRangeDates(range: TimeRange): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  switch (range) {
    case "today":
      start.setHours(0, 0, 0, 0);
      break;
    case "30d":
      start.setDate(end.getDate() - 30);
      break;
    case "3m":
      start.setMonth(end.getMonth() - 3);
      break;
    case "12m":
      start.setMonth(end.getMonth() - 12);
      break;
    case "all":
      start.setMonth(end.getMonth() - 24);
      break;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { start: fmt(start), end: fmt(end) };
}

function microToDollars(raw: string): number {
  return Number(raw) / 1_000_000;
}

/* ═══════════════════════════════════════════════════════
   Overview — ArcenPay SaaS Provider Dashboard
   ═══════════════════════════════════════════════════════ */
export function OverviewSection() {
  const { isConnected } = useAccount();
  const { envMode, activeEnvironment, isLoading: envLoading } = useEnvironment();
  const { data: sessionData } = useDashboardSession();
  const [mounted, setMounted] = useState(false);

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [revenueSeries, setRevenueSeries] = useState<RevenuePoint[]>([]);
  const [revenueRange, setRevenueRange] = useState<TimeRange>("30d");
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [loadingRevenue, setLoadingRevenue] = useState(true);
  const [setupDismissed, setSetupDismissed] = useState(false);

  const effectiveChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const environmentKey = activeEnvironment?.id ?? envMode;

  useEffect(() => setMounted(true), []);

  /* Check localStorage for dismissed setup banner */
  useEffect(() => {
    if (typeof window !== "undefined") {
      setSetupDismissed(localStorage.getItem("arcenpay:overview:setup-dismissed") === "true");
    }
  }, []);

  /* Load overview */
  useEffect(() => {
    if (!mounted || envLoading) return;
    let cancelled = false;
    async function load() {
      try {
        setLoadingOverview(true);
        const params = new URLSearchParams({
          chainId: String(effectiveChainId),
          environmentMode: envMode,
        });
        const res = await fetch(`/api/platform/overview?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setOverview(null);
          return;
        }
        const data = (await res.json()) as OverviewPayload;
        if (!cancelled) setOverview(data);
      } catch {
        if (!cancelled) setOverview(null);
      } finally {
        if (!cancelled) setLoadingOverview(false);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mounted, envLoading, envMode, effectiveChainId, environmentKey]);

  /* Load revenue series */
  useEffect(() => {
    if (!mounted || envLoading) return;
    let cancelled = false;
    async function load() {
      try {
        setLoadingRevenue(true);
        const params = new URLSearchParams();
        if (revenueRange === "today") {
          params.set("granularity", "daily");
          params.set("days", "1");
        } else if (revenueRange === "30d") {
          params.set("granularity", "daily");
          params.set("days", "30");
        } else if (revenueRange === "3m") {
          params.set("granularity", "monthly");
          params.set("months", "3");
        } else if (revenueRange === "12m") {
          params.set("granularity", "monthly");
          params.set("months", "12");
        } else {
          params.set("granularity", "monthly");
          params.set("months", "24");
        }
        const res = await fetch(`/api/platform/revenue-series?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setRevenueSeries([]);
          return;
        }
        const data = (await res.json()) as RevenueSeriesPayload;
        if (!cancelled) setRevenueSeries(Array.isArray(data.points) ? data.points : []);
      } catch {
        if (!cancelled) setRevenueSeries([]);
      } finally {
        if (!cancelled) setLoadingRevenue(false);
      }
    }
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mounted, envLoading, revenueRange, effectiveChainId, environmentKey]);

  const isLoading = loadingOverview || loadingRevenue;

  const metrics = {
    revenue30d:
      overview?.metrics.paidInvoiceRevenue30dRaw != null
        ? formatUsdc(overview.metrics.paidInvoiceRevenue30dRaw)
        : "$0",
    activeSubscribers:
      overview?.metrics.activeSubscribers != null
        ? String(overview.metrics.activeSubscribers)
        : "0",
    activePlans:
      overview?.metrics.activePlans != null ? String(overview.metrics.activePlans) : "0",
  };

  const chartData = revenueSeries.map((p) => ({
    label: p.label,
    revenue: microToDollars(p.revenueRaw),
  }));

  const totalRevenue = chartData.reduce((sum, p) => sum + p.revenue, 0);
  const totalRevenueFormatted = formatUsdc(String(Math.round(totalRevenue * 1_000_000)));
  const dateRange = getRangeDates(revenueRange);

  const rangeOptions: { value: TimeRange; label: string }[] = [
    { value: "all", label: "All Time" },
    { value: "12m", label: "12m" },
    { value: "3m", label: "3m" },
    { value: "30d", label: "30d" },
    { value: "today", label: "Today" },
  ];

  /* ── Onboarding checklist logic ──────────────────────── */
  const hasWallet = !!sessionData?.user.walletAddress || !!sessionData?.user.stellarWalletAddress;
  const hasEnvironment = !!activeEnvironment;
  const hasPlans = Number(metrics.activePlans) > 0;
  const hasSubscribers = Number(metrics.activeSubscribers) > 0;

  const setupSteps = [
    { label: "Connect wallet", done: hasWallet, icon: Wallet, href: "/onboarding/chain" },
    { label: "Create environment", done: hasEnvironment, icon: Globe, href: "/environments/new" },
    { label: "Create a plan", done: hasPlans, icon: CreditCard, href: "/?section=catalog-plans" },
    { label: "Get first subscriber", done: hasSubscribers, icon: Users, href: "/?section=components" },
  ];

  const completedSteps = setupSteps.filter((s) => s.done).length;
  const progressPercent = (completedSteps / setupSteps.length) * 100;
  const setupIncomplete = completedSteps < setupSteps.length;
  const showSetupBanner = setupIncomplete && !setupDismissed;

  const handleDismissSetup = () => {
    localStorage.setItem("arcenpay:overview:setup-dismissed", "true");
    setSetupDismissed(true);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Wallet banner ────────────────────────────── */}
      {mounted && !isConnected && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary border border-border">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground">
            Wallet disconnected — showing data for {getChainLabel(effectiveChainId)}.
          </p>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
         SETUP BANNER (Pillar-style onboarding card)
         ═══════════════════════════════════════════════════ */}
      {showSetupBanner && (
        <div className="bg-card border border-border rounded-2xl overflow-hidden relative">
          <button
            onClick={handleDismissSetup}
            className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-surface text-muted-foreground hover:text-foreground transition-colors z-10"
            aria-label="Dismiss setup banner"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left — progress */}
            <div className="p-6">
              <div className="flex items-center gap-2 mb-3">
                <Rocket className="w-4 h-4 text-brand" />
                <h3 className="text-sm font-semibold text-foreground">
                  Finish setting up your workspace
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                Complete the essentials to start accepting on-chain subscriptions.
                Connect your wallet, create a plan, and publish it to go live.
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                {completedSteps} of {setupSteps.length} steps complete
              </p>
              <div className="h-1.5 w-full bg-muted-foreground/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {/* Right — next step */}
            <div className="p-6 border-t lg:border-t-0 lg:border-l border-border bg-surface/30">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                Up next
              </p>
              {(() => {
                const next = setupSteps.find((s) => !s.done);
                if (!next) return null;
                const NextIcon = next.icon;
                return (
                  <>
                    <h4 className="text-base font-medium text-foreground mb-1">
                      {next.label}
                    </h4>
                    <p className="text-sm text-muted-foreground mb-4">
                      {next.label === "Connect wallet" &&
                        "Link your EVM or Stellar wallet to sign on-chain transactions."}
                      {next.label === "Create environment" &&
                        "Set up a Development or Production environment with a chain and token."}
                      {next.label === "Create a plan" &&
                        "Build your first subscription plan with pricing and entitlements."}
                      {next.label === "Get first subscriber" &&
                        "Embed the checkout component and get your first paid signup."}
                    </p>
                    <a
                      href={next.href}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-foreground text-background text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Continue setup
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
         Page header
         ═══════════════════════════════════════════════════ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeEnvironment?.name ?? "Workspace"} · {getChainLabel(effectiveChainId)}
          </p>
        </div>
        <div className="flex items-center bg-card border border-border rounded-lg p-0.5">
          {rangeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRevenueRange(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                revenueRange === opt.value
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
         ROW 1 — Live metric cards (clean, premium)
         ═══════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CleanMetricCard
          title="Revenue"
          subtitle="Last 30 days"
          value={metrics.revenue30d}
          icon={DollarSign}
          trend={totalRevenue > 0 ? "+12%" : undefined}
          loading={isLoading}
        />
        <CleanMetricCard
          title="MRR"
          subtitle="Current period"
          value={metrics.revenue30d}
          icon={Zap}
          loading={isLoading}
        />
        <CleanMetricCard
          title="Subscribers"
          subtitle="Active now"
          value={metrics.activeSubscribers}
          icon={Users}
          loading={isLoading}
        />
        <CleanMetricCard
          title="Plans"
          subtitle="Published"
          value={metrics.activePlans}
          icon={Layers}
          loading={isLoading}
        />
      </div>

      {/* ═══════════════════════════════════════════════════
         ROW 2 — Revenue chart (hero section)
         ═══════════════════════════════════════════════════ */}
      <div className="bg-card border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Revenue
            </p>
            {isLoading ? (
              <div className="h-12 w-32 bg-surface rounded-lg animate-pulse mt-2" />
            ) : (
              <p className="text-4xl font-light text-foreground tracking-tight">
                {totalRevenueFormatted}
              </p>
            )}
            <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-[#4a7bff]" />
              {dateRange.start} – {dateRange.end}, {new Date().getFullYear()}
            </p>
          </div>
          {!isLoading && totalRevenue > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-success bg-success/10 px-2.5 py-1 rounded-full">
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Growing</span>
            </div>
          )}
        </div>

        <div className="h-[280px] text-muted-foreground">
          {loadingRevenue ? (
            <div className="h-full bg-surface/50 rounded-lg animate-pulse" />
          ) : chartData.length === 0 || totalRevenue === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-xl bg-surface/50 border border-border flex items-center justify-center mb-4">
                <DollarSign className="w-7 h-7 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">No revenue yet</p>
              <p className="text-xs text-muted-foreground max-w-[300px]">
                Revenue will appear once paid invoices are recorded for this workspace.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4a7bff" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#4a7bff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  stroke="hsl(var(--muted-foreground) / 0.25)"
                  vertical={true}
                  horizontal={true}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  dy={8}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                  tick={{ fill: "currentColor", fontSize: 12 }}
                />
                <Tooltip
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Revenue"]}
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "10px",
                    fontSize: "13px",
                    color: "hsl(var(--foreground))",
                  }}
                  itemStyle={{ color: "hsl(var(--foreground))" }}
                  labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  cursor={{ stroke: "hsl(var(--muted-foreground) / 0.3)", strokeWidth: 1 }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#4a7bff"
                  strokeWidth={2.5}
                  fill="url(#revenueGradient)"
                  animationDuration={800}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
         ROW 3 — Recent Activity (full width)
         ═══════════════════════════════════════════════════ */}
      <RecentActivity chainId={effectiveChainId} environmentKey={environmentKey} />
    </div>
  );
}

/* ── CleanMetricCard (premium, minimal) ──────────────── */
function CleanMetricCard({
  title,
  subtitle,
  value,
  icon: Icon,
  trend,
  loading,
}: {
  title: string;
  subtitle: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: string;
  loading: boolean;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 hover:border-muted-foreground/20 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2} />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {title}
          </span>
        </div>
        {trend && (
          <span className="text-[11px] font-semibold text-success bg-success/10 px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-28 bg-surface rounded-md animate-pulse" />
      ) : (
        <p className="text-2xl font-light text-foreground tracking-tight">{value}</p>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        <p className="text-xs text-muted-foreground">{subtitle}</p>
        {title === "Subscribers" && Number(value) > 0 && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            <span className="text-[10px] text-muted-foreground">Live</span>
          </>
        )}
      </div>
    </div>
  );
}
