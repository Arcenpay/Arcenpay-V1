"use client";

import { useState, useEffect, useCallback } from "react";
import { SkeletonCard } from "@/components/ui/skeleton";
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
  Check,
  X,
  ArrowUpRight,
  Fuel,
  AlertTriangle,
  TrendingUp,
  Users,
  Layers,
  Shield,
  Headphones,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";

// ── Types ────────────────────────────────────────────────────────────────────

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

type TierFeatures = {
  analytics: boolean;
  webhooks: boolean;
  customBranding: boolean;
  apiAccess: boolean;
  prioritySupport: boolean;
  dedicatedSupport: boolean;
  managedPlanEditing: boolean;
  crossChainBilling: boolean;
  whiteGloveOnboarding: boolean;
};

type TierInfo = {
  tier: string;
  limits: TierLimits;
  pricing: { priceUsdc: number; interval: string };
  features: TierFeatures;
};

type CurrentTier = {
  tier: string;
  expiresAt: string | null;
  limits: TierLimits;
  usage: { plans: number; members: number };
};

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
    bgColor: "bg-muted/50",
    borderColor: "border-border",
    label: "Free",
    description: "2 dev + 2 prod environments",
  },
  PLUS: {
    icon: Crown,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    label: "Pro",
    description: "10 dev + 10 prod environments",
  },
  PRO: {
    icon: Rocket,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    label: "Enterprise",
    description: "Unlimited environments and support",
  },
};

const DEFAULT_TIER_CONFIG = TIER_CONFIG.FREE;

function getTierConfig(tier: string | null | undefined) {
  return TIER_CONFIG[tier as keyof typeof TIER_CONFIG] ?? DEFAULT_TIER_CONFIG;
}

const FEATURE_LABELS: {
  key: keyof TierFeatures;
  label: string;
  icon: React.ElementType;
}[] = [
  { key: "analytics", label: "Analytics", icon: TrendingUp },
  { key: "webhooks", label: "Webhooks", icon: Zap },
  { key: "customBranding", label: "Custom branding", icon: Shield },
  { key: "apiAccess", label: "API access", icon: Layers },
  {
    key: "crossChainBilling",
    label: "Cross-chain billing",
    icon: ArrowUpRight,
  },
  { key: "prioritySupport", label: "Priority support", icon: Headphones },
  { key: "dedicatedSupport", label: "Dedicated support", icon: MessageSquare },
  { key: "managedPlanEditing", label: "Managed plan editing", icon: Users },
  { key: "whiteGloveOnboarding", label: "White-glove onboarding", icon: Crown },
];

// ── Component ────────────────────────────────────────────────────────────────

export function BillingSection() {
  const [currentTier, setCurrentTier] = useState<CurrentTier | null>(null);
  const [allTiers, setAllTiers] = useState<TierInfo[]>([]);
  const [gasBudget, setGasBudget] = useState<GasBudget | null>(null);
  const [gasHistory, setGasHistory] = useState<GasHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgradeDialogOpen, setUpgradeDialogOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [upgrading, setUpgrading] = useState(false);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(
    "monthly",
  );

  const fetchData = useCallback(async () => {
    try {
      const [tierRes, gasRes] = await Promise.all([
        fetch("/api/platform/tier"),
        fetch("/api/platform/gas-budget?days=7"),
      ]);

      if (tierRes.ok) {
        const data = await tierRes.json();
        setCurrentTier(data.current);
        setAllTiers(data.allTiers);
      }

      if (gasRes.ok) {
        const data = await gasRes.json();
        setGasBudget(data.budget);
        setGasHistory(data.history);
      }
    } catch {
      toast.error("Failed to load billing data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpgrade = async () => {
    if (!selectedTier) return;
    setUpgrading(true);

    try {
      // For downgrades to FREE, no payment needed
      // For upgrades, in production this would trigger an on-chain payment first
      const res = await fetch("/api/platform/tier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTier: selectedTier,
          // txHash would come from on-chain payment in production
          ...(selectedTier !== "FREE"
            ? { txHash: `pending-${Date.now()}` }
            : {}),
        }),
      });

      const data = await res.json();

      if (res.ok) {
        toast.success(data.message);
        setUpgradeDialogOpen(false);
        fetchData();
      } else {
        toast.error(data.error || "Upgrade failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setUpgrading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
    );
  }

  const tierOrder = ["FREE", "PLUS", "PRO"];
  const currentTierIndex = tierOrder.indexOf(currentTier?.tier ?? "FREE");

  return (
    <div className="space-y-6">
      {/* Current Plan Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {currentTier &&
              (() => {
                const config = getTierConfig(currentTier.tier);
                const Icon = config.icon;
                return <Icon className={`w-5 h-5 ${config.color}`} />;
              })()}
            Current Plan:{" "}
            {getTierConfig(currentTier?.tier).label}
          </CardTitle>
          <CardDescription>
            {currentTier?.expiresAt
              ? `Expires ${new Date(currentTier.expiresAt).toLocaleDateString()}`
              : "No expiration"}
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

      {/* Gas Budget Widget */}
      {gasBudget && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Fuel className="w-5 h-5 text-orange-500" />
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

            {/* 7-day sparkline */}
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

      {/* Tier Comparison */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Compare Plans</h3>
          {/* Monthly / Yearly toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-secondary border border-border">
            <button
              onClick={() => setBillingInterval("monthly")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-all duration-200 ${
                billingInterval === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval("yearly")}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-medium transition-all duration-200 ${
                billingInterval === "yearly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Yearly
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-green-500/15 text-green-600 dark:text-green-400">
                -20%
              </span>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {allTiers.map((tierInfo) => {
            const config = getTierConfig(tierInfo.tier);
            const Icon = config.icon;
            const tierIndex = tierOrder.indexOf(tierInfo.tier);
            const isCurrent = tierInfo.tier === currentTier?.tier;
            const isUpgrade = tierIndex > currentTierIndex;
            const isDowngrade = tierIndex < currentTierIndex;

            const monthlyPrice = tierInfo.pricing.priceUsdc;
            const displayPrice =
              billingInterval === "yearly"
                ? Math.floor(monthlyPrice * 0.8)
                : monthlyPrice;

            return (
              <Card
                key={tierInfo.tier}
                className={`relative ${isCurrent ? config.borderColor + " border-2" : ""}`}
              >
                {isCurrent && (
                  <Badge
                    className="absolute -top-2.5 left-4 text-[10px]"
                    variant="default"
                  >
                    Current Plan
                  </Badge>
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${config.bgColor}`}>
                      <Icon className={`w-5 h-5 ${config.color}`} />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{config.label}</CardTitle>
                      <CardDescription className="text-xs">
                        {config.description}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="pt-2 flex items-end gap-1">
                    <span className="text-3xl font-bold">${displayPrice}</span>
                    <span className="text-sm text-muted-foreground mb-0.5">
                      /mo
                    </span>
                    {billingInterval === "yearly" && monthlyPrice > 0 && (
                      <span className="text-xs text-muted-foreground line-through mb-0.5 ml-1">
                        ${monthlyPrice}
                      </span>
                    )}
                  </div>
                  {billingInterval === "yearly" && monthlyPrice > 0 && (
                    <p className="text-[11px] text-green-600 dark:text-green-400 -mt-1">
                      Billed ${Math.floor(monthlyPrice * 0.8 * 12)}/yr
                    </p>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Limits */}
                  <div className="space-y-1.5 text-sm">
                    <LimitRow
                      label="Workspaces"
                      value={tierInfo.limits.maxWorkspaces}
                    />
                    <LimitRow label="Plans" value={tierInfo.limits.maxPlans} />
                    <LimitRow
                      label="Subscribers"
                      value={tierInfo.limits.maxSubscribers}
                    />
                    <LimitRow
                      label="Team members"
                      value={tierInfo.limits.maxTeamMembers}
                    />
                    <LimitRow
                      label="Development envs"
                      value={tierInfo.limits.maxDevelopmentEnvironments}
                    />
                    <LimitRow
                      label="Production envs"
                      value={tierInfo.limits.maxProductionEnvironments}
                    />
                    <div className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">
                        Platform fee
                      </span>
                      <span className="font-medium">
                        {(tierInfo.limits.platformFeeBps / 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span className="text-muted-foreground">Gas budget</span>
                      <span className="font-medium">
                        ${tierInfo.limits.gasDailyBudgetUsd}/day
                      </span>
                    </div>
                  </div>

                  {/* Features */}
                  <div className="border-t pt-3 space-y-1.5">
                    {FEATURE_LABELS.map(({ key, label }) => (
                      <div
                        key={key}
                        className="flex items-center gap-2 text-sm"
                      >
                        {tierInfo.features[key] ? (
                          <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0" />
                        )}
                        <span
                          className={
                            tierInfo.features[key]
                              ? "text-foreground"
                              : "text-muted-foreground/50"
                          }
                        >
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Current Plan
                      </Button>
                    ) : isUpgrade ? (
                      <Button
                        className="w-full"
                        onClick={() => {
                          setSelectedTier(tierInfo.tier);
                          setUpgradeDialogOpen(true);
                        }}
                      >
                        <ArrowUpRight className="w-4 h-4 mr-1" />
                        Upgrade to {config.label}
                      </Button>
                    ) : isDowngrade ? (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => {
                          setSelectedTier(tierInfo.tier);
                          setUpgradeDialogOpen(true);
                        }}
                      >
                        Downgrade to {config.label}
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Upgrade/Downgrade Dialog */}
      <Dialog open={upgradeDialogOpen} onOpenChange={setUpgradeDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedTier &&
              tierOrder.indexOf(selectedTier) > currentTierIndex
                ? "Upgrade"
                : "Downgrade"}{" "}
              to{" "}
              {selectedTier
                ? getTierConfig(selectedTier).label
                : ""}
            </DialogTitle>
            <DialogDescription>
              {selectedTier &&
              tierOrder.indexOf(selectedTier) > currentTierIndex ? (
                <>
                  You&apos;ll be charged{" "}
                  <strong>
                    $
                    {allTiers.find((t) => t.tier === selectedTier)?.pricing
                      .priceUsdc ?? 0}
                    /month
                  </strong>{" "}
                  in USDC. This requires an on-chain transaction.
                </>
              ) : (
                <>
                  Downgrading will reduce your limits. Make sure your current
                  usage is below the target tier&apos;s limits.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUpgradeDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button onClick={handleUpgrade} disabled={upgrading}>
              {upgrading
                ? "Processing..."
                : tierOrder.indexOf(selectedTier ?? "FREE") > currentTierIndex
                  ? "Confirm Upgrade"
                  : "Confirm Downgrade"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────────

function UsageMeter({
  label,
  current,
  max,
  icon: Icon,
}: {
  label: string;
  current: number;
  max: number;
  icon: React.ElementType;
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

function LimitRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value >= 999 ? "Unlimited" : value}</span>
    </div>
  );
}
