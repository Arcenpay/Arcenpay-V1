"use client";

import { useState, useEffect, useCallback } from "react";
import { SkeletonCard, Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Zap,
  Crown,
  Rocket,
  Fuel,
  AlertTriangle,
  Users,
  Layers,
  AlertCircle,
  Clock,
  RefreshCw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { ArcenEmbed } from "@arcenpay/react";
import { usePlatformBillingEmbed } from "@/hooks/use-platform-billing-embed";


// ── Types ────────────────────────────────────────────────────────────────────

type PlatformBillingReadiness =
  | "NOT_CONFIGURED"
  | "BOOTSTRAP_MISSING"
  | "BOOTSTRAP_FAILED"
  | "READY"
  | "ACTIVE"
  | "PAST_DUE";

type TierLimits = {
  maxWorkspaces: number;
  maxPlans: number;
  maxSubscribers: number;
  maxTeamMembers: number;
  maxFeatureFlags: number;
  maxChains: number;
  maxDevelopmentEnvironments: number;
  maxProductionEnvironments: number;
  platformFeeBps: number;
  gasDailyBudgetUsd: number;
};

type CurrentTier = {
  tier: string;
  expiresAt: string | null;
  limits: TierLimits;
  usage: { plans: number; members: number };
} | null;

type SubscriptionStatus = {
  status: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  pastDueAt: string | null;
  graceEndsAt: string | null;
  tier: string | null;
  amount: number;
} | null;

type GasBudget = {
  tier: string;
  dailyBudgetUsd: number;
  spentTodayUsd: number;
  remainingUsd: number;
  isGasSponsored: boolean;
  budgetAlertTriggered: boolean;
  txCountToday: number;
};

type GasHistoryEntry = {
  date: string;
  totalUsd: number;
  txCount: number;
};

// ── Tier display config ──────────────────────────────────────────────────────

const TIER_CONFIG = {
  FREE: {
    icon: Zap,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
    label: "Free",
  },
  PLUS: {
    icon: Crown,
    color: "text-foreground",
    bgColor: "bg-secondary",
    label: "Growth",
  },
  PRO: {
    icon: Rocket,
    color: "text-foreground",
    bgColor: "bg-secondary",
    label: "Enterprise",
  },
};

const DEFAULT_TIER_CONFIG = TIER_CONFIG.FREE;

function getTierConfig(tier: string | null | undefined) {
  return TIER_CONFIG[tier as keyof typeof TIER_CONFIG] ?? DEFAULT_TIER_CONFIG;
}

// ── Readiness banner ─────────────────────────────────────────────────────────

function ReadinessBanner({
  readiness,
  subscription,
}: {
  readiness: PlatformBillingReadiness;
  subscription: SubscriptionStatus;
}) {
  if (readiness === "ACTIVE" || readiness === "READY") return null;

  const bannerConfig: Record<
    PlatformBillingReadiness,
    { icon: LucideIcon; color: string; title: string; body: string } | null
  > = {
    NOT_CONFIGURED: {
      icon: AlertCircle,
      color: "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
      title: "Platform billing not configured",
      body: "The ops signer and treasury address environment variables are not set. Contact your platform admin.",
    },
    BOOTSTRAP_MISSING: {
      icon: AlertCircle,
      color: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
      title: "Platform plans not yet deployed",
      body: "ArcenPay Pro/Enterprise billing plans have not been bootstrapped on Arc testnet. Use the bootstrap button below (OWNER only) or contact support.",
    },
    BOOTSTRAP_FAILED: {
      icon: AlertCircle,
      color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
      title: "Bootstrap configuration mismatch",
      body: "On-chain plan parameters do not match. Contact ArcenPay support to resolve the configuration mismatch.",
    },
    PAST_DUE: {
      icon: Clock,
      color: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
      title: "Subscription past due",
      body: subscription?.graceEndsAt
        ? `Your subscription renewal failed. Grace period ends ${new Date(subscription.graceEndsAt).toLocaleDateString()}. Update your payment method to avoid downgrade.`
        : "Your subscription renewal failed. Please update your payment method.",
    },
    ACTIVE: null,
    READY: null,
  };

  const config = bannerConfig[readiness];
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border ${config.color}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">{config.title}</p>
        <p className="text-xs mt-0.5 opacity-80">{config.body}</p>
      </div>
    </div>
  );
}

// ── Usage Meter ──────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  max,
  icon: Icon,
}: {
  label: string;
  current: number;
  max: number;
  icon: LucideIcon;
}) {
  const percent = max > 0 ? (current / max) * 100 : 0;
  const isNearLimit = percent >= 80;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="text-lg font-semibold">
        {current}
        <span className="text-sm font-normal text-muted-foreground">
          {" "}
          / {max === 999 ? "\u221E" : max}
        </span>
      </p>
      <Progress
        value={Math.min(percent, 100)}
        className={`h-1.5 ${isNearLimit ? "[&>div]:bg-destructive" : ""}`}
      />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BillingSection() {
  const [currentTier, setCurrentTier] = useState<CurrentTier>(null);
  const [gasBudget, setGasBudget] = useState<GasBudget | null>(null);
  const [gasHistory, setGasHistory] = useState<GasHistoryEntry[]>([]);
  const [billingReadiness, setBillingReadiness] = useState<PlatformBillingReadiness>("READY");
  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapping, setBootstrapping] = useState(false);

  const [downgradeDialogOpen, setDowngradeDialogOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const {
    token: embedToken,
    componentId: embedComponentId,
    loading: embedLoading,
    error: embedError,
    refresh: refreshEmbed,
  } = usePlatformBillingEmbed();

  const fetchPlatformData = useCallback(async () => {
    try {
      const [tierRes, gasRes] = await Promise.all([
        fetch("/api/platform/tier"),
        fetch("/api/platform/gas-budget?days=7"),
      ]);

      if (tierRes.ok) {
        const data = await tierRes.json();
        setCurrentTier(data.current);
        setBillingReadiness(data.billingReadiness ?? "READY");
        setSubscription(data.subscription ?? null);
      }

      if (gasRes.ok) {
        const data = await gasRes.json();
        setGasBudget(data.budget);
        setGasHistory(data.history);
      }
    } catch {
      toast.error("Failed to load platform data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlatformData();
  }, [fetchPlatformData]);

  async function handleBootstrap() {
    setBootstrapping(true);
    try {
      const res = await fetch("/api/platform/tier/bootstrap", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success("Platform billing plans bootstrapped successfully.");
        fetchPlatformData();
      } else {
        toast.error(data.message ?? data.error ?? "Bootstrap failed.");
      }
    } catch {
      toast.error("Network error during bootstrap.");
    } finally {
      setBootstrapping(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Tier card skeleton matching actual layout */}
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
          <div className="flex flex-col space-y-1.5 p-6">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-16 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="p-6 pt-0">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-lg border p-3 space-y-2">
                <Skeleton className="h-3 w-12" />
                <Skeleton className="h-6 w-8" />
                <Skeleton className="h-2 w-full" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-8" />
                <Skeleton className="h-2 w-full" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-2 w-full" />
              </div>
              <div className="rounded-lg border p-3 space-y-2">
                <Skeleton className="h-3 w-14" />
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-2 w-full" />
              </div>
            </div>
          </div>
        </div>
        <SkeletonCard lines={4} />
      </div>
    );
  }

  const tierConfig = getTierConfig(currentTier?.tier);
  const TierIcon = tierConfig.icon;

  return (
    <div className="space-y-6">
      <ReadinessBanner readiness={billingReadiness} subscription={subscription} />

      {(billingReadiness === "BOOTSTRAP_MISSING" || billingReadiness === "BOOTSTRAP_FAILED") && (
        <div className="flex items-center justify-between px-4 py-3 rounded-lg border bg-muted/30">
          <div>
            <p className="text-sm font-medium">Bootstrap Platform Plans</p>
            <p className="text-xs text-muted-foreground">
              Deploy PLUS/PRO plans to Arc testnet via the ops signer (OWNER only)
            </p>
          </div>
          <Button size="sm" onClick={handleBootstrap} disabled={bootstrapping}>
            {bootstrapping ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                Bootstrapping…
              </>
            ) : (
              "Bootstrap Now"
            )}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TierIcon className={`w-5 h-5 ${tierConfig.color}`} />
              Current Plan: {tierConfig.label}
              {subscription?.status === "ACTIVE" && (
                <Badge variant="outline" className="text-[10px] text-green-600 border-green-500/30 bg-green-500/10 animate-fade-in font-semibold">
                  Active
                </Badge>
              )}
              {subscription?.status === "PAST_DUE" && (
                <Badge variant="destructive" className="text-[10px] font-semibold">
                  <AlertTriangle className="w-2.5 h-2.5 mr-1 animate-pulse" />
                  Past Due
                </Badge>
              )}
            </CardTitle>
          </div>
          <CardDescription>
            {currentTier?.expiresAt
              ? `Renews ${new Date(currentTier.expiresAt).toLocaleDateString()}`
              : "No expiration"}
            {subscription?.currentPeriodEnd && (
              <span className="ml-2 text-muted-foreground/60">
                · Period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <UsageMeter
              label="Plans"
              current={currentTier?.usage.plans ?? 0}
              max={currentTier?.limits.maxPlans ?? 1}
              icon={Layers}
            />
            <UsageMeter
              label="Team Members"
              current={currentTier?.usage.members ?? 0}
              max={currentTier?.limits.maxTeamMembers ?? 1}
              icon={Users}
            />
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Platform Fee</p>
              <p className="text-lg font-semibold">
                {((currentTier?.limits.platformFeeBps ?? 200) / 100).toFixed(1)}
                %
              </p>
              <p className="text-[10px] text-muted-foreground">
                per transaction
              </p>
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Environments</p>
              <p className="text-lg font-semibold">
                {currentTier?.limits.maxDevelopmentEnvironments === 999 ||
                currentTier?.limits.maxProductionEnvironments === 999
                  ? "Unlimited"
                  : `${currentTier?.limits.maxDevelopmentEnvironments ?? 2} dev / ${currentTier?.limits.maxProductionEnvironments ?? 2} prod`}
              </p>
              <p className="text-[10px] text-muted-foreground">workspace slots</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {gasBudget && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fuel className="w-5 h-5 text-foreground" />
              Gas Sponsorship
              {gasBudget.budgetAlertTriggered && (
                <Badge variant="destructive" className="text-[10px]">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Budget Low
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Your platform covers gas fees for subscriber transactions on L2
              chains
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Today&apos;s Spend
                </p>
                <p className="text-2xl font-bold">
                  ${gasBudget.spentTodayUsd.toFixed(4)}
                  <span className="text-sm font-normal text-muted-foreground">
                    {" "}
                    / ${gasBudget.dailyBudgetUsd.toFixed(2)}
                  </span>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Transactions</p>
                <p className="text-2xl font-bold">{gasBudget.txCountToday}</p>
              </div>
            </div>

            <div className="space-y-1">
              <Progress
                value={
                  gasBudget.dailyBudgetUsd > 0
                    ? (gasBudget.spentTodayUsd / gasBudget.dailyBudgetUsd) * 100
                    : 0
                }
                className="h-2"
              />
              <p className="text-[10px] text-muted-foreground text-right">
                ${gasBudget.remainingUsd.toFixed(4)} remaining
              </p>
            </div>

            {gasHistory.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  Last 7 days
                </p>
                <div className="flex items-end gap-1 h-12">
                  {gasHistory.map((entry, i) => {
                    const max = Math.max(
                      ...gasHistory.map((e) => e.totalUsd),
                      0.01,
                    );
                    const height = Math.max((entry.totalUsd / max) * 100, 4);
                    return (
                      <div
                        key={i}
                        className="flex-1 bg-orange-500/20 hover:bg-orange-500/40 rounded-t transition-colors cursor-default"
                        style={{ height: `${height}%` }}
                        title={`${entry.date}: $${entry.totalUsd.toFixed(4)} (${entry.txCount} txs)`}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-lg font-semibold mb-4">Subscription & Plans</h3>
        {embedLoading ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <RefreshCw className="w-6 h-6 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Loading billing portal…</span>
            </CardContent>
          </Card>
        ) : embedError ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <AlertCircle className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{embedError}</p>
              <Button variant="outline" size="sm" onClick={refreshEmbed}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : embedToken && embedComponentId ? (
          <Card className="overflow-hidden border-border">
            <CardContent className="p-4">
              <ArcenEmbed
                accessToken={embedToken}
                componentId={embedComponentId}
                hideBranding
                onPlanChange={() => {
                  toast.success("Platform subscription updated!");
                  fetchPlatformData();
                  refreshEmbed();
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
              <AlertCircle className="w-10 h-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Unable to load billing portal.</p>
              <Button variant="outline" size="sm" onClick={refreshEmbed}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <DowngradeDialog
        open={downgradeDialogOpen}
        onOpenChange={setDowngradeDialogOpen}
        selectedTier={selectedTier}
        currentTier={currentTier}
        onSuccess={fetchPlatformData}
      />
    </div>
  );
}

// ── Downgrade Dialog ─────────────────────────────────────────────────────────

function DowngradeDialog({
  open,
  onOpenChange,
  selectedTier,
  currentTier,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedTier: string | null;
  currentTier: CurrentTier | null;
  onSuccess: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleDowngrade() {
    if (!selectedTier) return;
    setLoading(true);

    try {
      const res = await fetch("/api/platform/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: selectedTier }),
      });

      const data = await res.json();

      if (res.ok && data.ok) {
        toast.success(data.message ?? "Downgraded successfully.");
        onOpenChange(false);
        onSuccess();
      } else if (res.status === 409) {
        const violations = (data.violations ?? []) as string[];
        toast.error(
          violations.length > 0
            ? violations.join(" | ")
            : data.message ?? "Cannot downgrade due to usage limits.",
        );
      } else {
        toast.error(data.message ?? data.error ?? "Downgrade failed.");
      }
    } catch {
      toast.error("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-white p-6 rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Downgrade to {getTierConfig(selectedTier).label}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            Downgrading will reduce your limits immediately. Make sure your current usage is
            within the target tier&apos;s limits.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 flex gap-2 justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDowngrade} disabled={loading}>
            {loading ? "Downgrading…" : "Confirm Downgrade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
