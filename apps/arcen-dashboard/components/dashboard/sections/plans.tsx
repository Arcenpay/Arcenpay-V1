"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Layers,
  Search,
  MoreHorizontal,
  Archive,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  TransactionFlow,
  type TransactionStep,
} from "@/components/dashboard/transaction-flow";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSimulateContract,
} from "wagmi";
import { toast } from "sonner";
import {
  useContractAddresses,
  PlanFactoryABI,
  TOKENS,
} from "@/lib/contracts";
import {
  formatUsdc,
  formatInterval,
  getBlockExplorerUrl,
  getBlockExplorerBase,
  truncateAddress,
} from "@/lib/format";

type BillingInterval = "monthly" | "quarterly" | "annual";

interface Plan {
  id: string;
  name: string;
  tier: string;
  priceRaw: bigint;
  billingInterval: number;
  active: boolean;
  subscriberCount?: number;
  txHash?: string;
}

const INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual",
};

const INTERVAL_SECONDS: Record<BillingInterval, number> = {
  monthly: 2592000,
  quarterly: 7776000,
  annual: 31536000,
};

function PlanStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge
      variant={active ? "default" : "secondary"}
      className={cn(
        "text-xs",
        active
          ? "bg-success/10 text-success border-success/20"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {active ? "Active" : "Archived"}
    </Badge>
  );
}

export function PlansSection() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contractAddresses = useContractAddresses();
  const chainUsdc =
    TOKENS[chainId as keyof typeof TOKENS]?.USDC || TOKENS[11155111].USDC;

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "All" | "Active" | "Archived"
  >("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);

  // Create plan form state
  const [newPlan, setNewPlan] = useState({
    name: "",
    priceUsdc: "",
    interval: "monthly" as BillingInterval,
    features: "",
    acceptedToken: chainUsdc,
  });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [txStep, setTxStep] = useState<TransactionStep>("idle");
  const [txError, setTxError] = useState("");
  const [txHashCreate, setTxHashCreate] = useState<string>("");

  // ── Read: fetch provider plan IDs ────────────────────────
  const {
    data: planIdsData,
    isLoading: planIdsLoading,
    refetch: refetchPlanIds,
  } = useReadContracts({
    contracts: [
      {
        address: contractAddresses.planFactory as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "getProviderPlans",
        args: [address ?? "0x0000000000000000000000000000000000000000"],
        chainId,
      },
    ],
    query: { enabled: isConnected && !!address },
  });

  const planIds = (planIdsData?.[0]?.result as bigint[] | undefined) ?? [];

  // ── Read: fetch each plan struct ────────────────────────
  const planContracts = planIds.map((id) => ({
    address: contractAddresses.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "getPlan" as const,
    args: [id] as [bigint],
    chainId,
  }));

  const {
    data: plansRawData,
    isLoading: plansLoading,
    refetch: refetchPlans,
  } = useReadContracts({
    contracts: planContracts,
    query: { enabled: planIds.length > 0 },
  });

  const plans: Plan[] = (plansRawData ?? [])
    .map((result, i) => {
      if (result.status !== "success") return null;
      const p = result.result as {
        id: bigint;
        provider: string;
        name: string;
        tier: string;
        price: bigint;
        billingInterval: number;
        acceptedToken: string;
        active: boolean;
        metadataURI: string;
      };
      return {
        id: p.id.toString(),
        name: p.name,
        tier: p.tier,
        priceRaw: p.price,
        billingInterval: p.billingInterval,
        active: p.active,
      } as Plan;
    })
    .filter(Boolean) as Plan[];

  const isLoading = planIdsLoading || plansLoading;

  // ── Write: create plan ────────────────────────────────────
  const priceInUnits = newPlan.priceUsdc
    ? BigInt(Math.round(parseFloat(newPlan.priceUsdc) * 1_000_000))
    : 0n;

  const { error: simulateError } = useSimulateContract({
    address: contractAddresses.planFactory as `0x${string}`,
    abi: PlanFactoryABI,
    functionName: "createPlan",
    args: [
      newPlan.name,
      newPlan.name, // tier = name as default
      priceInUnits,
      INTERVAL_SECONDS[newPlan.interval],
      newPlan.acceptedToken as `0x${string}`,
      "",
    ],
    query: {
      enabled:
        showCreateDialog &&
        txStep === "simulating" &&
        !!newPlan.name &&
        priceInUnits > 0n,
    },
  });

  const { writeContractAsync } = useWriteContract();

  const { data: createReceipt, isLoading: waitingForReceipt } =
    useWaitForTransactionReceipt({
      hash: txHashCreate as `0x${string}` | undefined,
      query: { enabled: !!txHashCreate },
    });

  useEffect(() => {
    if (createReceipt) {
      setTxStep("success");
      refetchPlanIds();
      refetchPlans();
      toast.success("Plan deployed on-chain!");
      setTimeout(() => {
        setShowCreateDialog(false);
        setTxStep("idle");
        setTxHashCreate("");
        setNewPlan({
          name: "",
          priceUsdc: "",
          interval: "monthly",
          features: "",
          acceptedToken: chainUsdc,
        });
      }, 2500);
    }
  }, [createReceipt, chainUsdc]);

  useEffect(() => {
    setNewPlan((prev) => ({ ...prev, acceptedToken: chainUsdc }));
  }, [chainUsdc]);

  // ── Write: deactivate plan ────────────────────────────────
  const { writeContractAsync: writeDeactivate } = useWriteContract();

  const filtered = plans.filter((p) => {
    const matchesSearch = p.name
      .toLowerCase()
      .includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "All" ||
      (statusFilter === "Active" && p.active) ||
      (statusFilter === "Archived" && !p.active);
    return matchesSearch && matchesStatus;
  });

  const validateForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!newPlan.name.trim()) errors.name = "Plan name is required";
    if (!newPlan.priceUsdc.trim()) {
      errors.priceUsdc = "Price is required";
    } else if (
      isNaN(Number(newPlan.priceUsdc)) ||
      Number(newPlan.priceUsdc) <= 0
    ) {
      errors.priceUsdc = "Price must be a positive number";
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreatePlan = async () => {
    if (!validateForm()) return;
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }

    setTxStep("simulating");
    setTxError("");

    // Wait briefly for simulation query to run
    await new Promise((r) => setTimeout(r, 1000));

    if (simulateError) {
      setTxStep("error");
      setTxError(simulateError.message);
      return;
    }

    try {
      setTxStep("pending");
      const hash = await writeContractAsync({
        address: contractAddresses.planFactory as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "createPlan",
        args: [
          newPlan.name,
          newPlan.name,
          priceInUnits,
          INTERVAL_SECONDS[newPlan.interval],
          newPlan.acceptedToken as `0x${string}`,
          "",
        ],
      });
      setTxHashCreate(hash);
      setTxStep("inflight");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTxStep("error");
      setTxError(msg);
      toast.error("Transaction rejected");
    }
  };

  const handleArchivePlan = async (planId: string) => {
    if (!isConnected) return;
    setPendingArchiveId(planId);
    try {
      await writeDeactivate({
        address: contractAddresses.planFactory as `0x${string}`,
        abi: PlanFactoryABI,
        functionName: "deactivatePlan",
        args: [BigInt(planId)],
      });
      toast.success("Plan deactivated");
      refetchPlanIds();
      refetchPlans();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to deactivate plan";
      toast.error(msg);
    } finally {
      setPendingArchiveId(null);
    }
  };

  const handleCopyPlanId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCloseDialog = () => {
    if (
      txStep === "inflight" ||
      txStep === "pending" ||
      txStep === "simulating"
    )
      return;
    setShowCreateDialog(false);
    setTxStep("idle");
    setTxError("");
    setFormErrors({});
    setTxHashCreate("");
    setNewPlan({
      name: "",
      priceUsdc: "",
      interval: "monthly",
      features: "",
      acceptedToken: chainUsdc,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Create and manage your subscription plans on-chain
          </p>
        </div>
        <Button
          className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
          onClick={() => setShowCreateDialog(true)}
          disabled={!isConnected}
        >
          <Plus className="w-4 h-4" />
          Create Plan
        </Button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search plans…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["All", "Active", "Archived"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                statusFilter === filter
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Plan Name
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Price (USDC)
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Interval
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tier
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Status
                </th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                isConnected &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="py-3 px-4">
                        <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                      </td>
                    ))}
                    <td className="py-3 px-4" />
                  </tr>
                ))}
              {!isLoading &&
                filtered.map((plan, index) => (
                  <tr
                    key={plan.id}
                    className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors animate-in fade-in slide-in-from-left-2"
                    style={{
                      animationDelay: `${index * 40}ms`,
                      animationFillMode: "both",
                    }}
                  >
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {plan.name}
                        </p>
                        <code className="text-xs text-muted-foreground font-mono">
                          ID: {plan.id}
                        </code>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium text-foreground">
                        {formatUsdc(plan.priceRaw)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {formatInterval(plan.billingInterval)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {plan.tier}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <PlanStatusBadge active={plan.active} />
                    </td>
                    <td className="py-3 px-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            {pendingArchiveId === plan.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="w-4 h-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => handleCopyPlanId(plan.id)}
                            className="flex items-center gap-2 text-sm"
                          >
                            {copiedId === plan.id ? (
                              <Check className="w-3.5 h-3.5 text-success" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            Copy Plan ID
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <a
                              href={getBlockExplorerUrl(
                                chainId,
                                "address",
                                contractAddresses.planFactory,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              View Contract
                            </a>
                          </DropdownMenuItem>
                          {plan.active && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleArchivePlan(plan.id)}
                                className="flex items-center gap-2 text-sm text-muted-foreground"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                Archive Plan
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
              <Layers className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {searchQuery || statusFilter !== "All"
                ? "No plans match your filter"
                : !isConnected
                  ? "Connect your wallet to view plans"
                  : "No plans created yet"}
            </p>
            <p className="text-xs text-muted-foreground max-w-[320px] mb-4">
              Create your first subscription plan to start accepting subscribers
              through the ArcenPay protocol
            </p>
            {!searchQuery && statusFilter === "All" && isConnected && (
              <Button
                className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90"
                onClick={() => setShowCreateDialog(true)}
              >
                <Plus className="w-4 h-4" />
                Create Your First Plan
              </Button>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            Showing {filtered.length} plan{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Create Plan Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Subscription Plan</DialogTitle>
            <DialogDescription>
              Deploy a new plan to PlanFactory on-chain. This requires a wallet
              transaction (~120k gas).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Plan Name */}
            <div className="space-y-2">
              <Label htmlFor="planName">Plan Name</Label>
              <Input
                id="planName"
                placeholder="e.g. Pro, Enterprise, Starter"
                value={newPlan.name}
                onChange={(e) => {
                  setNewPlan((p) => ({ ...p, name: e.target.value }));
                  setFormErrors((e_) => ({ ...e_, name: "" }));
                }}
                className="bg-secondary border-border focus:border-accent"
                disabled={txStep !== "idle"}
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>

            {/* Price + Interval */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="planPrice">Price (USDC)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="planPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="9.99"
                    value={newPlan.priceUsdc}
                    onChange={(e) => {
                      setNewPlan((p) => ({ ...p, priceUsdc: e.target.value }));
                      setFormErrors((e_) => ({ ...e_, priceUsdc: "" }));
                    }}
                    className="bg-secondary border-border focus:border-accent pl-6"
                    disabled={txStep !== "idle"}
                  />
                </div>
                {formErrors.priceUsdc && (
                  <p className="text-xs text-destructive">
                    {formErrors.priceUsdc}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Billing Interval</Label>
                <div className="flex flex-col gap-1">
                  {(
                    ["monthly", "quarterly", "annual"] as BillingInterval[]
                  ).map((interval) => (
                    <button
                      key={interval}
                      onClick={() => setNewPlan((p) => ({ ...p, interval }))}
                      disabled={txStep !== "idle"}
                      className={cn(
                        "w-full px-3 py-1.5 rounded-lg text-xs font-medium border text-left transition-all duration-200",
                        newPlan.interval === interval
                          ? "bg-accent text-accent-foreground border-accent"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {INTERVAL_LABELS[interval]}
                      <span className="ml-1 opacity-60 text-xs">
                        ({(INTERVAL_SECONDS[interval] / 86400).toFixed(0)}d)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="acceptedToken">Accepted Token</Label>
              <Input
                id="acceptedToken"
                value={`USDC (${truncateAddress(newPlan.acceptedToken)})`}
                readOnly
                className="bg-secondary border-border text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Token is resolved from active chain configuration (USDC-first
                GA policy).
              </p>
            </div>

            {/* Features */}
            <div className="space-y-2">
              <Label htmlFor="planFeatures">Feature Keys (optional)</Label>
              <Input
                id="planFeatures"
                placeholder="e.g. advanced_analytics, custom_domain"
                value={newPlan.features}
                onChange={(e) =>
                  setNewPlan((p) => ({ ...p, features: e.target.value }))
                }
                className="bg-secondary border-border focus:border-accent"
                disabled={txStep !== "idle"}
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated feature flag keys to bundle with this plan
              </p>
            </div>

            {/* Gas estimate */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
              <span className="text-xs text-muted-foreground">
                Estimated gas:{" "}
                <span className="text-foreground font-medium">~120,000</span>{" "}
                units · calls{" "}
                <code className="font-mono text-accent text-xs">
                  PlanFactory.createPlan()
                </code>
              </span>
            </div>

            {/* Transaction flow */}
            <TransactionFlow
              step={txStep}
              txHash={txHashCreate || createReceipt?.transactionHash}
              blockExplorerUrl={getBlockExplorerBase(chainId)}
              gasEstimate="~120k gas"
              errorMessage={txError}
              onDismiss={() => {
                setTxStep("idle");
                setTxError("");
              }}
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={handleCloseDialog}
              disabled={
                txStep === "inflight" ||
                txStep === "pending" ||
                txStep === "simulating"
              }
            >
              Cancel
            </Button>
            <Button
              className="bg-accent text-accent-foreground hover:bg-accent/90 min-w-[140px]"
              onClick={handleCreatePlan}
              disabled={txStep !== "idle" && txStep !== "error"}
            >
              {txStep === "simulating" && (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Simulating…
                </>
              )}
              {txStep === "pending" && (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Confirm in Wallet
                </>
              )}
              {txStep === "inflight" && (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Submitting…
                </>
              )}
              {txStep === "success" && (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2 text-success" />
                  Plan Created!
                </>
              )}
              {(txStep === "idle" || txStep === "error") && (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Deploy Plan
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
