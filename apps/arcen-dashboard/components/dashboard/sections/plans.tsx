"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { keepPreviousData } from "@tanstack/react-query";
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
  ChevronDown,
  RefreshCw,
  Pencil,
  List,
  ToggleLeft,
  Hash,
  Package,
  Trash2,
  ChevronRight,
  PanelRightOpen,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  TransactionFlow,
  type TransactionStep,
} from "@/components/dashboard/transaction-flow";
import {
  useAccount,
  useChainId,
  useReadContracts,
  useWriteContract,
  usePublicClient,
} from "wagmi";
import { toast } from "sonner";
import {
  useContractAddresses,
  PlanFactoryABI,
  getUsdcAddress,
  getUsdcTokenOptions,
} from "@/lib/contracts";
import {
  formatUsdc,
  formatInterval,
  getBlockExplorerUrl,
  getBlockExplorerBase,
  truncateAddress,
} from "@/lib/format";

type BillingInterval = "monthly" | "quarterly" | "annual";

const USDC_OPTIONS = getUsdcTokenOptions();

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
  const chainUsdc = getUsdcAddress(chainId);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "All" | "Active" | "Archived"
  >("All");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingArchiveId, setPendingArchiveId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbPlans, setDbPlans] = useState<
    Array<{
      id: string;
      name: string;
      tier: string;
      price: string;
      billingInterval: number;
      active: boolean;
      status: string;
      acceptedToken: string;
      onChainPlanId?: string | null;
      chainSyncStatus?: string;
    }>
  >([]);

  // Edit plan state
  const [editingPlan, setEditingPlan] = useState<{
    id: string;
    name: string;
    tier: string;
    priceUsdc: string;
    billingInterval: string;
    acceptedToken: string;
  } | null>(null);
  const [editLoading, setEditLoading] = useState(false);

  // Create plan form state
  const [newPlan, setNewPlan] = useState({
    name: "",
    description: "",
    priceUsdc: "",
    planType: "free" as "free" | "paid",
    interval: "monthly" as BillingInterval,
    features: "",
    acceptedToken: chainUsdc as `0x${string}`,
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
    query: { enabled: planIds.length > 0, placeholderData: keepPreviousData },
  });

  // Keep a stable ref so the effect below can always call the latest refetch
  // without needing it as a dependency (avoids circular updates).
  const refetchPlansRef = useRef(refetchPlans);
  refetchPlansRef.current = refetchPlans;

  const refetchPlanIdsRef = useRef(refetchPlanIds);
  refetchPlanIdsRef.current = refetchPlanIds;

  // ── Database-backed plan list ─────────────────────────────
  // The on-chain reads (getProviderPlans) rely on wagmi's cache,
  // which has complex invalidation. Load from the DB API as primary source.
  const fetchDbPlans = useCallback(async () => {
    setDbLoading(true);
    try {
      const res = await fetch("/api/catalog/plans");
      if (res.ok) {
        const data = await res.json();
        setDbPlans(Array.isArray(data.plans) ? data.plans : []);
      }
    } catch {
      // ignore
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDbPlans();
  }, [fetchDbPlans]);

  // When planIds changes (new plan created), refetch plan details with the
  // updated planContracts. React Query auto-invalidates the old query key but
  // we must explicitly trigger the fetch for the new key.
  const planIdsKey = planIds.map(String).join(",");
  useEffect(() => {
    if (planIds.length > 0) void refetchPlansRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planIdsKey]);

  // Manual refresh: re-fetch from DB + chain
  const handleManualRefresh = useCallback(async () => {
    fetchDbPlans();
    await refetchPlanIdsRef.current();
    setTimeout(() => void refetchPlansRef.current(), 500);
  }, [fetchDbPlans]);

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

  // Merge on-chain plans with DB plans.
  // DB plans are the primary source; on-chain provides real-time status.
  const mergedPlans = dbPlans.map((dbPlan) => {
    const onChainMatch = plans.find(
      (p) => p.id === dbPlan.onChainPlanId || p.name === dbPlan.name,
    );
    return {
      id: dbPlan.id,
      onChainId: dbPlan.onChainPlanId ?? onChainMatch?.id ?? null,
      name: dbPlan.name,
      tier: dbPlan.tier,
      priceRaw:
        onChainMatch?.priceRaw ??
        BigInt(Math.round(parseFloat(dbPlan.price) * 1_000_000)),
      billingInterval:
        onChainMatch?.billingInterval ?? dbPlan.billingInterval * 86400,
      active:
        onChainMatch?.active ?? (dbPlan.status !== "ARCHIVED" && dbPlan.active),
      status: dbPlan.status,
    };
  });

  const isLoading = (planIdsLoading || plansLoading) && dbLoading;

  // ── Write: create plan ────────────────────────────────────
  const priceInUnits =
    newPlan.planType === "free"
      ? 0n
      : newPlan.priceUsdc
        ? BigInt(Math.round(parseFloat(newPlan.priceUsdc) * 1_000_000))
        : 0n;

  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    setNewPlan((prev) => ({ ...prev, acceptedToken: chainUsdc }));
  }, [chainUsdc]);

  // ── Write: deactivate plan ────────────────────────────────
  const { writeContractAsync: writeDeactivate } = useWriteContract();

  const filtered = mergedPlans.filter((p) => {
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
    if (newPlan.planType === "paid") {
      if (newPlan.priceUsdc.trim() === "") {
        errors.priceUsdc = "Price is required for paid plans";
      } else if (isNaN(Number(newPlan.priceUsdc)) || Number(newPlan.priceUsdc) <= 0) {
        errors.priceUsdc = "Price must be greater than 0";
      }
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

    setTxError("");

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
        gas: 500_000n,
      });
      setTxHashCreate(hash);
      setTxStep("inflight");

      await publicClient!.waitForTransactionReceipt({
        hash,
        pollingInterval: 2_000, // poll every 2s (Sepolia ~12s blocks)
        timeout: 120_000, // 2 minute total timeout
      });

      setTxStep("success");

      // ── Persist plan to database ────────────────────────────────────────────
      // The on-chain read (getProviderPlans) has a multi-render cycle delay.
      // Saving to our DB immediately gives an instant, reliable list update.
      try {
        const intervalDays = Math.round(
          INTERVAL_SECONDS[newPlan.interval] / 86400,
        );
        await fetch("/api/catalog/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: newPlan.name,
            tier: newPlan.name,
            price: Number(newPlan.priceUsdc),
            billingInterval: intervalDays,
            acceptedToken: newPlan.acceptedToken,
            environmentMode: "DEVELOPMENT",
          }),
        });
      } catch {
        // non-critical – the plan is on-chain regardless
      }

      // Refresh both DB list and chain reads
      await fetchDbPlans();
      await refetchPlanIds();
      setTimeout(() => void refetchPlansRef.current(), 300);

      toast.success("Plan deployed on-chain!");
      setTimeout(() => {
        setShowCreateDialog(false);
        setTxStep("idle");
        setTxHashCreate("");
        setNewPlan({
          name: "",
          description: "",
          priceUsdc: "",
          planType: "free",
          interval: "monthly",
          features: "",
          acceptedToken: chainUsdc,
        });
      }, 3000);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg =
        raw.includes("could not be found") || raw.includes("timed out")
          ? "Transaction submitted but receipt not found yet — check the block explorer to confirm."
          : raw;
      setTxStep("error");
      setTxError(msg);
      toast.error(
        raw.includes("User rejected")
          ? "Transaction rejected"
          : "Transaction failed",
      );
    }
  };

  const handleArchivePlan = async (plan: {
    id: string;
    onChainId: string | null;
    name: string;
  }) => {
    setPendingArchiveId(plan.id);
    try {
      // If we have an actual on-chain numeric ID, call the contract
      if (plan.onChainId && /^\d+$/.test(plan.onChainId) && isConnected) {
        await writeDeactivate({
          address: contractAddresses.planFactory as `0x${string}`,
          abi: PlanFactoryABI,
          functionName: "deactivatePlan",
          args: [BigInt(plan.onChainId)],
        });
      }
      // Always update DB status to ARCHIVED
      await fetch("/api/catalog/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          status: "ARCHIVED",
          active: false,
        }),
      });
      toast.success(`"${plan.name}" archived`);
      await fetchDbPlans();
      refetchPlanIds();
      refetchPlans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to archive plan";
      toast.error(msg);
    } finally {
      setPendingArchiveId(null);
    }
  };

  const handleDeletePlan = async (plan: {
    id: string;
    onChainId: string | null;
    name: string;
    status: string;
  }) => {
    if (plan.status === "PUBLISHED") {
      toast.error(
        "Published plans cannot be deleted. Archive the plan instead.",
      );
      return;
    }
    if (plan.onChainId) {
      toast.error(
        "On-chain plans cannot be deleted. Archive the plan instead.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete plan "${plan.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setPendingDeleteId(plan.id);
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: plan.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error || "Failed to delete plan");
      }

      toast.success(`"${plan.name}" deleted`);
      await fetchDbPlans();
      refetchPlanIds();
      refetchPlans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete plan";
      toast.error(msg);
    } finally {
      setPendingDeleteId(null);
    }
  };

  const handleEditSave = async () => {
    if (!editingPlan) return;
    setEditLoading(true);
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingPlan.id,
          name: editingPlan.name,
          tier: editingPlan.tier,
          price: Number(editingPlan.priceUsdc),
          billingInterval: Number(editingPlan.billingInterval),
          acceptedToken: editingPlan.acceptedToken,
        }),
      });
      if (res.ok) {
        toast.success("Plan updated");
        setEditingPlan(null);
        await fetchDbPlans();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to update plan");
      }
    } catch {
      toast.error("Failed to update plan");
    } finally {
      setEditLoading(false);
    }
  };

  const handleCopyPlanId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // ── Entitlements sheet ───────────────────────────────────────────────────────
  interface Entitlement {
    featureName: string;
    featureKey: string;
    type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
    value?: boolean | number | null;
    enabled: boolean;
  }

  interface FeatureFlag {
    key: string;
    label: string;
    type: string;
    planTiers: string[];
    enabledCount: number;
    totalCount: number;
  }

  const [entPlan, setEntPlan] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [entLoading, setEntLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [entSearch, setEntSearch] = useState("");
  const [addEntOpen, setAddEntOpen] = useState(false);
  const [addEntLoading, setAddEntLoading] = useState(false);
  const [addEntErrors, setAddEntErrors] = useState<Record<string, string>>({});
  const [addEntForm, setAddEntForm] = useState({
    featureName: "",
    featureKey: "",
    type: "BOOLEAN" as "BOOLEAN" | "NUMERIC" | "UNLIMITED",
    value: "",
    enabled: true,
  });

  // Per-plan entitlements cache for the features column in the table
  const [planEntitlements, setPlanEntitlements] = useState<
    Record<string, Entitlement[]>
  >({});

  // Feature flag suggestions (loaded when the add-entitlement form opens)
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);

  // Copy-from-plan state
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyingEntitlements, setCopyingEntitlements] = useState(false);

  const loadEntitlements = useCallback(async (planId: string) => {
    setEntLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${planId}/entitlements`);
      if (res.ok) {
        const data = await res.json();
        const ents: Entitlement[] = data.entitlements ?? [];
        setEntitlements(ents);
        setPlanEntitlements((prev) => ({ ...prev, [planId]: ents }));
      }
    } finally {
      setEntLoading(false);
    }
  }, []);

  // Load entitlements when a plan is opened
  useEffect(() => {
    if (entPlan) loadEntitlements(entPlan.id);
  }, [entPlan, loadEntitlements]);

  // Batch-load entitlements for all plans (populates the Features column)
  const allPlansKey = dbPlans.map((p) => p.id).join(",");
  useEffect(() => {
    if (dbPlans.length === 0) return;
    Promise.all(
      dbPlans.map((plan) =>
        fetch(`/api/catalog/plans/${plan.id}/entitlements`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => ({
            id: plan.id,
            ents: (data?.entitlements ?? []) as Entitlement[],
          }))
          .catch(() => ({ id: plan.id, ents: [] as Entitlement[] })),
      ),
    ).then((results) => {
      const map: Record<string, Entitlement[]> = {};
      results.forEach(({ id, ents }) => {
        if (ents.length > 0) map[id] = ents;
      });
      if (Object.keys(map).length > 0) {
        setPlanEntitlements((prev) => ({ ...prev, ...map }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPlansKey]);

  // Fetch feature flag suggestions when the add-entitlement form opens
  useEffect(() => {
    if (!addEntOpen || !address) return;
    setFlagsLoading(true);
    fetch(`/api/entitlements/provider/${address}/flags`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.flags) setFeatureFlags(data.flags as FeatureFlag[]);
      })
      .catch(() => {})
      .finally(() => setFlagsLoading(false));
  }, [addEntOpen, address]);

  const openEntitlements = (plan: { id: string; name: string }) => {
    setEntPlan(plan);
    setEntSearch("");
    setAddEntOpen(false);
    setAddEntForm({
      featureName: "",
      featureKey: "",
      type: "BOOLEAN",
      value: "",
      enabled: true,
    });
    setAddEntErrors({});
  };

  const deleteEntitlement = async (planId: string, featureKey: string) => {
    setDeletingKey(featureKey);
    try {
      const res = await fetch(
        `/api/catalog/plans/${planId}/entitlements?featureKey=${featureKey}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        toast.success("Entitlement removed");
        await loadEntitlements(planId);
      } else {
        toast.error("Failed to remove entitlement");
      }
    } finally {
      setDeletingKey(null);
    }
  };

  const toggleEntitlement = async (
    planId: string,
    featureKey: string,
    enabled: boolean,
  ) => {
    // Optimistic update so the toggle feels instant
    setEntitlements((prev) =>
      prev.map((e) => (e.featureKey === featureKey ? { ...e, enabled } : e)),
    );
    setTogglingKey(featureKey);
    try {
      await fetch(`/api/catalog/plans/${planId}/entitlements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureKey, enabled }),
      });
      await loadEntitlements(planId); // sync with server
    } finally {
      setTogglingKey(null);
    }
  };

  function autoKey(name: string) {
    return name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "");
  }

  const handleAddEntitlement = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!addEntForm.featureName.trim()) errs.featureName = "Required";
    if (!addEntForm.featureKey.trim()) errs.featureKey = "Required";
    else if (!/^[a-z0-9_-]+$/i.test(addEntForm.featureKey))
      errs.featureKey = "Letters, numbers, _ and - only";
    if (addEntForm.type === "NUMERIC") {
      const n = Number(addEntForm.value);
      if (addEntForm.value === "" || isNaN(n) || n < 0)
        errs.value = "Must be a non-negative number";
    }
    if (Object.keys(errs).length) {
      setAddEntErrors(errs);
      return;
    }
    if (!entPlan) return;
    setAddEntLoading(true);
    try {
      let val: boolean | number | null = null;
      if (addEntForm.type === "BOOLEAN") val = addEntForm.enabled;
      else if (addEntForm.type === "NUMERIC") val = Number(addEntForm.value);
      const res = await fetch(`/api/catalog/plans/${entPlan.id}/entitlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureName: addEntForm.featureName,
          featureKey: addEntForm.featureKey,
          type: addEntForm.type,
          value: val,
          enabled: addEntForm.enabled,
        }),
      });
      if (res.ok) {
        setAddEntOpen(false);
        setAddEntForm({
          featureName: "",
          featureKey: "",
          type: "BOOLEAN",
          value: "",
          enabled: true,
        });
        setAddEntErrors({});
        toast.success("Entitlement added");
        await loadEntitlements(entPlan.id); // reload list immediately
      } else {
        const data = await res.json();
        setAddEntErrors({ _global: data.error || "Failed to add entitlement" });
      }
    } finally {
      setAddEntLoading(false);
    }
  };

  // Copy all entitlements from another plan into the currently-open plan
  const handleCopyFromPlan = async (sourcePlanId: string) => {
    if (!entPlan) return;
    setCopyingEntitlements(true);
    setCopyFromOpen(false);
    try {
      const res = await fetch(
        `/api/catalog/plans/${sourcePlanId}/entitlements`,
      );
      if (!res.ok) {
        toast.error("Could not load source plan entitlements");
        return;
      }
      const data = await res.json();
      const sourceEnts: Entitlement[] = data.entitlements ?? [];
      if (sourceEnts.length === 0) {
        toast.info("Source plan has no entitlements to copy");
        return;
      }
      await Promise.allSettled(
        sourceEnts.map((ent) =>
          fetch(`/api/catalog/plans/${entPlan.id}/entitlements`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              featureName: ent.featureName,
              featureKey: ent.featureKey,
              type: ent.type,
              value: ent.value ?? null,
              enabled: ent.enabled,
            }),
          }),
        ),
      );
      toast.success(
        `Copied ${sourceEnts.length} entitlement${sourceEnts.length !== 1 ? "s" : ""}`,
      );
      await loadEntitlements(entPlan.id);
    } catch {
      toast.error("Failed to copy entitlements");
    } finally {
      setCopyingEntitlements(false);
    }
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
      description: "",
      priceUsdc: "",
      planType: "free",
      interval: "monthly",
      features: "",
      acceptedToken: chainUsdc,
    });
  };

  const totalPlans = mergedPlans.length;
  const activePlans = mergedPlans.filter((p) => p.active).length;
  const archivedPlans = mergedPlans.filter((p) => !p.active).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Create and manage your subscription plans on-chain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-2"
            onClick={handleManualRefresh}
            disabled={isLoading}
            title="Refresh plans from chain"
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            className="flex items-center gap-2"
            onClick={() => setShowCreateDialog(true)}
            disabled={!isConnected}
          >
            <Plus className="w-4 h-4" />
            Create Plan
          </Button>
        </div>
      </div>

      {/* Search + Filter */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Total Plans
          </p>
          <p className="text-2xl font-semibold text-foreground mt-1">
            {totalPlans}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Active
          </p>
          <p className="text-2xl font-semibold text-success mt-1">
            {activePlans}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Archived
          </p>
          <p className="text-2xl font-semibold text-muted-foreground mt-1">
            {archivedPlans}
          </p>
        </div>
      </div>

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
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Features
                </th>
                <th className="w-12"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                isConnected &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 6 }).map((__, j) => (
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
                      <button
                        onClick={() =>
                          openEntitlements({ id: plan.id, name: plan.name })
                        }
                        className="text-left group"
                      >
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium text-foreground group-hover:text-accent transition-colors">
                            {plan.name}
                          </p>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        {plan.onChainId && (
                          <code className="text-xs text-muted-foreground font-mono">
                            On-chain ID: {plan.onChainId}
                          </code>
                        )}
                      </button>
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
                      {(() => {
                        const ents = planEntitlements[plan.id] ?? [];
                        if (ents.length === 0)
                          return (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          );
                        const shown = ents.slice(0, 2);
                        const extra = ents.length - shown.length;
                        return (
                          <div className="flex flex-wrap gap-1">
                            {shown.map((e) => (
                              <span
                                key={e.featureKey}
                                className="text-xs bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground truncate max-w-[100px]"
                              >
                                {e.featureName}
                              </span>
                            ))}
                            {extra > 0 && (
                              <span className="text-xs text-muted-foreground">
                                +{extra}
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                          >
                            {pendingArchiveId === plan.id ||
                            pendingDeleteId === plan.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="w-4 h-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              openEntitlements({ id: plan.id, name: plan.name })
                            }
                            className="flex items-center gap-2 text-sm"
                          >
                            <List className="w-3.5 h-3.5" />
                            Manage Entitlements
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              // find the original DB plan to pre-fill
                              const dbPlan = dbPlans.find(
                                (p) => p.id === plan.id,
                              );
                              setEditingPlan({
                                id: plan.id,
                                name: plan.name,
                                tier: plan.tier,
                                priceUsdc: dbPlan
                                  ? parseFloat(dbPlan.price).toFixed(2)
                                  : "",
                                billingInterval: dbPlan
                                  ? String(dbPlan.billingInterval)
                                  : "30",
                                acceptedToken: dbPlan?.acceptedToken ?? "",
                              });
                            }}
                            className="flex items-center gap-2 text-sm"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Edit Plan
                          </DropdownMenuItem>
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
                                onClick={() => handleArchivePlan(plan)}
                                className="flex items-center gap-2 text-sm text-destructive focus:text-destructive"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                Archive Plan
                              </DropdownMenuItem>
                            </>
                          )}
                          {!plan.onChainId && plan.status !== "PUBLISHED" && (
                            <DropdownMenuItem
                              onClick={() => handleDeletePlan(plan)}
                              className="flex items-center gap-2 text-sm text-destructive focus:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Delete Plan
                            </DropdownMenuItem>
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
                className="flex items-center gap-2"
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

      {/* Create Plan Sheet — SchematicHQ split layout */}
      <Sheet
        open={showCreateDialog}
        onOpenChange={(open) => {
          if (!open) handleCloseDialog();
          else setShowCreateDialog(true);
        }}
      >
        <SheetContent className="w-full sm:max-w-4xl p-0 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
            <div />
            <button
              onClick={handleCloseDialog}
              disabled={txStep === "inflight" || txStep === "pending" || txStep === "simulating"}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all disabled:opacity-50"
            >
              ✕
            </button>
          </div>

          {/* Body — two columns */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* ── LEFT: Plan Preview ───────────────────── */}
            <div className="w-[320px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                  Create Plan
                </p>
                {/* Icon + Name */}
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 shrink-0" />
                  <p className="text-base font-bold text-foreground truncate">
                    {newPlan.name || <span className="text-muted-foreground font-normal">Untitled plan</span>}
                  </p>
                </div>
              </div>

              {/* Preview card */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-3">Plan Preview</p>
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  {/* Plan info */}
                  <div className="p-4 border-b border-border">
                    <p className="text-lg font-bold text-foreground leading-tight">
                      {newPlan.name || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {newPlan.description || newPlan.name || "—"}
                    </p>
                    {newPlan.planType === "paid" && newPlan.priceUsdc && (
                      <p className="text-sm font-semibold text-foreground mt-1">
                        ${newPlan.priceUsdc} USDC
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          / {INTERVAL_LABELS[newPlan.interval].toLowerCase()}
                        </span>
                      </p>
                    )}
                    {newPlan.planType === "free" && (
                      <p className="text-sm font-semibold text-foreground mt-1">Free</p>
                    )}
                  </div>
                  {/* Entitlements placeholder */}
                  <div className="p-4">
                    <p className="text-xs text-muted-foreground text-center py-4">
                      No entitlements exist on the plan yet
                    </p>
                  </div>
                  {/* Subscribe button */}
                  <div className="px-4 pb-4">
                    <button className="w-full py-2.5 rounded-lg bg-secondary border border-border text-sm font-medium text-muted-foreground">
                      Subscribe
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ── RIGHT: Plan Settings ─────────────────── */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-8">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Plan Settings</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      All Environments
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">A company can only have one base plan.</p>
                </div>

                {/* Icon + Name */}
                <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
                  <div>
                    <p className="text-sm font-medium text-foreground mb-2">Icon</p>
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-indigo-600 border border-border" />
                  </div>
                  <div>
                    <Label htmlFor="planName" className="text-sm font-medium text-foreground mb-2 block">Name</Label>
                    <Input
                      id="planName"
                      placeholder="e.g. Pro, Enterprise, Starter"
                      value={newPlan.name}
                      onChange={(e) => {
                        setNewPlan((p) => ({ ...p, name: e.target.value }));
                        setFormErrors((e_) => ({ ...e_, name: "" }));
                      }}
                      className="h-11 bg-background border-border"
                      disabled={txStep !== "idle"}
                    />
                    {formErrors.name && (
                      <p className="text-xs text-destructive mt-1">{formErrors.name}</p>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label htmlFor="planDesc" className="text-sm font-medium text-foreground mb-2 block">Description</Label>
                  <Input
                    id="planDesc"
                    placeholder="Describe this plan"
                    value={newPlan.description}
                    onChange={(e) => setNewPlan((p) => ({ ...p, description: e.target.value }))}
                    className="h-11 bg-background border-border"
                    disabled={txStep !== "idle"}
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Optional</p>
                </div>

                {/* Pricing section */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">Pricing</h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
                      DEV
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">Monetize your offering with flexible pricing options</p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={txStep !== "idle"}
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
                          >
                            <span className="font-medium capitalize">{newPlan.planType === "free" ? "Free" : "Paid"}</span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem onClick={() => setNewPlan((p) => ({ ...p, planType: "free", priceUsdc: "" }))}>
                            <div>
                              <p className="text-sm font-medium">Free</p>
                              <p className="text-xs text-muted-foreground">No charge — $0.00 USDC</p>
                            </div>
                            {newPlan.planType === "free" && <Check className="w-4 h-4 ml-auto text-foreground" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setNewPlan((p) => ({ ...p, planType: "paid" }))}>
                            <div>
                              <p className="text-sm font-medium">Paid</p>
                              <p className="text-xs text-muted-foreground">Recurring USDC payment</p>
                            </div>
                            {newPlan.planType === "paid" && <Check className="w-4 h-4 ml-auto text-foreground" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration — chains */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Billing Integration</Label>
                      {(() => {
                        const connectedOpt = USDC_OPTIONS.find((o) => o.chainId === chainId);
                        const selected = USDC_OPTIONS.find((o) => o.address === newPlan.acceptedToken) ?? connectedOpt;
                        const chainName = (opt: typeof USDC_OPTIONS[number]) =>
                          opt.label.replace(/USDC — |Custom USDC — /, "");
                        const chainInitial = (opt: typeof USDC_OPTIONS[number]) => {
                          const name = chainName(opt);
                          if (name.includes("Base")) return "B";
                          if (name.includes("Sepolia")) return "S";
                          return name[0]?.toUpperCase() ?? "?";
                        };

                        const renderRow = (opt: typeof USDC_OPTIONS[number]) => {
                          const isConnected = opt.chainId === chainId;
                          const isSelected = newPlan.acceptedToken === opt.address;
                          return (
                            <DropdownMenuItem
                              key={opt.chainId}
                              disabled={!isConnected}
                              onClick={() => isConnected && setNewPlan((p) => ({ ...p, acceptedToken: opt.address }))}
                              className={cn(
                                "flex items-center justify-between gap-3 py-2.5",
                                !isConnected && "opacity-40 cursor-not-allowed"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <div className={cn(
                                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0 border",
                                  isConnected
                                    ? "bg-foreground text-background border-foreground"
                                    : "bg-secondary text-muted-foreground border-border"
                                )}>
                                  <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                </div>
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-medium leading-tight">{chainName(opt)}</p>
                                    {isConnected && (
                                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background leading-none">
                                        Connected
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                    USDC · {truncateAddress(opt.address)}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {!isConnected && (
                                  <span className="text-[9px] font-medium text-muted-foreground">Switch wallet</span>
                                )}
                                {isSelected && isConnected && (
                                  <Check className="w-3.5 h-3.5 text-foreground" />
                                )}
                              </div>
                            </DropdownMenuItem>
                          );
                        };

                        return (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                disabled={txStep !== "idle"}
                                className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-medium truncate">
                                    {selected ? chainName(selected) : "Select chain"}
                                  </span>
                                  {selected && (
                                    <span className={cn(
                                      "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0",
                                      selected.tag === "mainnet"
                                        ? "bg-success/10 text-success"
                                        : "bg-secondary text-muted-foreground border border-border"
                                    )}>
                                      {selected.tag}
                                    </span>
                                  )}
                                  {selected?.chainId === chainId && (
                                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">
                                      Connected
                                    </span>
                                  )}
                                </div>
                                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-80">
                              {/* Testnets */}
                              {USDC_OPTIONS.some((o) => o.tag === "testnet") && (
                                <>
                                  <div className="px-2 pt-2 pb-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Testnets</p>
                                  </div>
                                  {USDC_OPTIONS.filter((o) => o.tag === "testnet").map(renderRow)}
                                </>
                              )}
                              {/* Mainnets */}
                              {USDC_OPTIONS.some((o) => o.tag === "mainnet") && (
                                <>
                                  <DropdownMenuSeparator />
                                  <div className="px-2 pt-2 pb-1">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mainnets</p>
                                  </div>
                                  {USDC_OPTIONS.filter((o) => o.tag === "mainnet").map(renderRow)}
                                </>
                              )}
                              {/* Footer hint */}
                              <div className="px-2 py-2 mt-1 border-t border-border">
                                <p className="text-[10px] text-muted-foreground">
                                  Switch your wallet network to enable other chains
                                </p>
                              </div>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Paid-only: Price + Interval */}
                  {newPlan.planType === "paid" && (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <Label htmlFor="planPrice" className="text-sm font-medium text-foreground mb-2 block">Price (USDC)</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                          <Input
                            id="planPrice"
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="9.99"
                            value={newPlan.priceUsdc}
                            onChange={(e) => {
                              setNewPlan((p) => ({ ...p, priceUsdc: e.target.value }));
                              setFormErrors((e_) => ({ ...e_, priceUsdc: "" }));
                            }}
                            className="h-11 bg-background border-border pl-6"
                            disabled={txStep !== "idle"}
                          />
                        </div>
                        {formErrors.priceUsdc && (
                          <p className="text-xs text-destructive mt-1">{formErrors.priceUsdc}</p>
                        )}
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-foreground mb-2 block">Billing Interval</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              disabled={txStep !== "idle"}
                              className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
                            >
                              <span className="font-medium">{INTERVAL_LABELS[newPlan.interval]}</span>
                              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                            {(["monthly", "quarterly", "annual"] as BillingInterval[]).map((iv) => (
                              <DropdownMenuItem key={iv} onClick={() => setNewPlan((p) => ({ ...p, interval: iv }))} className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">{INTERVAL_LABELS[iv]}</p>
                                  <p className="text-xs text-muted-foreground">{(INTERVAL_SECONDS[iv] / 86400).toFixed(0)} days</p>
                                </div>
                                {newPlan.interval === iv && <Check className="w-4 h-4 text-foreground ml-auto" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )}
                </div>

                {/* Transaction flow */}
                {txStep !== "idle" && (
                  <TransactionFlow
                    step={txStep}
                    txHash={txHashCreate}
                    blockExplorerUrl={getBlockExplorerBase(chainId)}
                    gasEstimate="~120k gas"
                    errorMessage={txError}
                    onDismiss={() => {
                      setTxStep("idle");
                      setTxError("");
                    }}
                  />
                )}

                {/* Gas note */}
                {txStep === "idle" && (
                  <p className="text-xs text-muted-foreground">
                    Deploying on-chain via{" "}
                    <code className="font-mono text-foreground">PlanFactory.createPlan()</code>{" "}
                    · ~120,000 gas
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
            <Button
              variant="outline"
              onClick={handleCloseDialog}
              disabled={txStep === "inflight" || txStep === "pending" || txStep === "simulating"}
            >
              Cancel
            </Button>
            <Button
              className="min-w-[140px]"
              onClick={handleCreatePlan}
              disabled={txStep !== "idle" && txStep !== "error"}
            >
              {txStep === "simulating" && <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Simulating…</>}
              {txStep === "pending" && <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Confirm in Wallet</>}
              {txStep === "inflight" && <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Submitting…</>}
              {txStep === "success" && <><CheckCircle2 className="w-4 h-4 mr-2 text-success" />Plan Created!</>}
              {(txStep === "idle" || txStep === "error") && <>Save Changes</>}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Edit Plan Sheet */}
      <Sheet
        open={!!editingPlan}
        onOpenChange={(open) => {
          if (!open) setEditingPlan(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <PanelRightOpen className="w-4 h-4 text-accent" />
              Edit Plan
            </SheetTitle>
            <SheetDescription>
              Update the plan details stored in your catalog.
            </SheetDescription>
          </SheetHeader>
          {editingPlan && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4">
                <div className="space-y-2">
                  <Label htmlFor="editName">Plan Name</Label>
                  <Input
                    id="editName"
                    value={editingPlan.name}
                    onChange={(e) =>
                      setEditingPlan((p) =>
                        p ? { ...p, name: e.target.value } : p,
                      )
                    }
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editTier">Tier</Label>
                  <Input
                    id="editTier"
                    value={editingPlan.tier}
                    onChange={(e) =>
                      setEditingPlan((p) =>
                        p ? { ...p, tier: e.target.value } : p,
                      )
                    }
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-card p-4">
                <div className="space-y-2">
                  <Label htmlFor="editPrice">Price (USDC)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="editPrice"
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingPlan.priceUsdc}
                      onChange={(e) =>
                        setEditingPlan((p) =>
                          p ? { ...p, priceUsdc: e.target.value } : p,
                        )
                      }
                      className="bg-secondary border-border focus:border-accent pl-6"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editInterval">Billing Interval (days)</Label>
                  <Input
                    id="editInterval"
                    type="number"
                    min="1"
                    value={editingPlan.billingInterval}
                    onChange={(e) =>
                      setEditingPlan((p) =>
                        p ? { ...p, billingInterval: e.target.value } : p,
                      )
                    }
                    className="bg-secondary border-border focus:border-accent"
                  />
                </div>
              </div>
              <div className="space-y-2 rounded-xl border border-border bg-card p-4">
                <Label htmlFor="editToken">Accepted Token</Label>
                <Input
                  id="editToken"
                  value={editingPlan.acceptedToken}
                  onChange={(e) =>
                    setEditingPlan((p) =>
                      p ? { ...p, acceptedToken: e.target.value } : p,
                    )
                  }
                  className="bg-secondary border-border focus:border-accent"
                />
              </div>
            </div>
          )}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t border-border pt-4 mt-4 flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingPlan(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={editLoading}>
              {editLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Entitlements Sheet ─────────────────────────────── */}
      <Sheet
        open={!!entPlan}
        onOpenChange={(open) => {
          if (!open) setEntPlan(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <List className="w-5 h-5 text-accent" />
              {entPlan?.name} — Entitlements
            </SheetTitle>
            <SheetDescription>
              Define which features are included in this plan. Click a plan name
              in the table to return.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 pt-4">
            {/* Search + Add */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Find entitlement…"
                  value={entSearch}
                  onChange={(e) => setEntSearch(e.target.value)}
                  className="w-full h-9 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
              </div>
              <Button
                size="sm"
                className="gap-1.5 shrink-0"
                onClick={() => setAddEntOpen((v) => !v)}
              >
                <Plus className="w-4 h-4" />
                Add
              </Button>
              <DropdownMenu open={copyFromOpen} onOpenChange={setCopyFromOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={copyingEntitlements}
                    className="gap-1.5 shrink-0"
                    title="Copy entitlements from another plan"
                  >
                    {copyingEntitlements ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                    Copy from
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {mergedPlans.filter((p) => p.id !== entPlan?.id).length ===
                  0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No other plans
                    </div>
                  ) : (
                    mergedPlans
                      .filter((p) => p.id !== entPlan?.id)
                      .map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          onClick={() => handleCopyFromPlan(p.id)}
                          className="text-sm"
                        >
                          {p.name}
                        </DropdownMenuItem>
                      ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Add entitlement inline form */}
            {addEntOpen && (
              <form
                onSubmit={handleAddEntitlement}
                className="space-y-3 p-4 rounded-xl border border-accent/30 bg-accent/5"
              >
                <p className="text-sm font-semibold text-foreground">
                  New Entitlement
                </p>
                {addEntErrors._global && (
                  <p className="text-xs text-destructive">
                    {addEntErrors._global}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Feature Name *</Label>
                    <Input
                      value={addEntForm.featureName}
                      onChange={(e) => {
                        const name = e.target.value;
                        setAddEntForm((f) => ({
                          ...f,
                          featureName: name,
                          featureKey: f.featureKey || autoKey(name),
                        }));
                      }}
                      placeholder="e.g. Advanced Analytics"
                      className="bg-secondary border-border h-8 text-sm"
                    />
                    {addEntErrors.featureName && (
                      <p className="text-xs text-destructive">
                        {addEntErrors.featureName}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Feature Key *</Label>
                    <Input
                      value={addEntForm.featureKey}
                      onChange={(e) =>
                        setAddEntForm((f) => ({
                          ...f,
                          featureKey: e.target.value,
                        }))
                      }
                      placeholder="advanced_analytics"
                      className="bg-secondary border-border h-8 text-sm font-mono"
                    />
                    {addEntErrors.featureKey && (
                      <p className="text-xs text-destructive">
                        {addEntErrors.featureKey}
                      </p>
                    )}
                  </div>
                </div>
                {/* Feature flag suggestions */}
                {(flagsLoading || featureFlags.length > 0) && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Suggestions from your feature flags:
                    </p>
                    {flagsLoading ? (
                      <div className="flex gap-1.5 flex-wrap">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-6 w-20 rounded-full bg-secondary animate-pulse"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap">
                        {featureFlags.map((flag) => (
                          <button
                            key={flag.key}
                            type="button"
                            onClick={() =>
                              setAddEntForm((f) => ({
                                ...f,
                                featureName: flag.label || flag.key,
                                featureKey: flag.key,
                                type:
                                  flag.type === "number"
                                    ? "NUMERIC"
                                    : "BOOLEAN",
                              }))
                            }
                            className="text-xs px-2 py-1 rounded-full bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
                          >
                            {flag.label || flag.key}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">Type *</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["BOOLEAN", "NUMERIC", "UNLIMITED"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setAddEntForm((f) => ({ ...f, type: t, value: "" }))
                        }
                        className={cn(
                          "flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-all",
                          addEntForm.type === t
                            ? "bg-accent text-accent-foreground border-accent"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {t === "BOOLEAN" ? (
                          <ToggleLeft className="w-4 h-4" />
                        ) : t === "NUMERIC" ? (
                          <Hash className="w-4 h-4" />
                        ) : (
                          <Package className="w-4 h-4" />
                        )}
                        {t === "BOOLEAN"
                          ? "On/Off"
                          : t === "NUMERIC"
                            ? "Numeric"
                            : "Unlimited"}
                      </button>
                    ))}
                  </div>
                </div>
                {addEntForm.type === "NUMERIC" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Value *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={addEntForm.value}
                      onChange={(e) =>
                        setAddEntForm((f) => ({ ...f, value: e.target.value }))
                      }
                      placeholder="e.g. 1000"
                      className="bg-secondary border-border h-8 text-sm"
                    />
                    {addEntErrors.value && (
                      <p className="text-xs text-destructive">
                        {addEntErrors.value}
                      </p>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
                  <div>
                    <p className="text-sm font-medium">Enabled</p>
                    <p className="text-xs text-muted-foreground">
                      Active on the plan immediately
                    </p>
                  </div>
                  <Switch
                    checked={addEntForm.enabled}
                    onCheckedChange={(v) =>
                      setAddEntForm((f) => ({ ...f, enabled: v }))
                    }
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setAddEntOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={addEntLoading}>
                    {addEntLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                        Adding…
                      </>
                    ) : (
                      "Add Entitlement"
                    )}
                  </Button>
                </div>
              </form>
            )}

            {/* Entitlements list */}
            {entLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-14 rounded-xl bg-secondary/60 animate-pulse"
                  />
                ))}
              </div>
            ) : (
              (() => {
                const filtered = entitlements.filter(
                  (e) =>
                    e.featureName
                      .toLowerCase()
                      .includes(entSearch.toLowerCase()) ||
                    e.featureKey
                      .toLowerCase()
                      .includes(entSearch.toLowerCase()),
                );
                return filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
                      <List className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">
                      {entSearch
                        ? "No entitlements match"
                        : "No entitlements yet"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entSearch
                        ? "Try a different search"
                        : "Click Add to define features included in this plan"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((ent) => (
                      <div
                        key={ent.featureKey}
                        className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/30 transition-colors"
                      >
                        {/* Type icon */}
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                          {ent.type === "BOOLEAN" ? (
                            <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                          ) : ent.type === "NUMERIC" ? (
                            <Hash className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Package className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {ent.featureName}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <code className="text-xs text-muted-foreground font-mono">
                              {ent.featureKey}
                            </code>
                            {ent.type === "NUMERIC" && ent.value != null && (
                              <span className="text-xs text-muted-foreground">
                                · limit: {String(ent.value)}
                              </span>
                            )}
                            {ent.type === "UNLIMITED" && (
                              <span className="text-xs text-muted-foreground">
                                · unlimited
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Toggle */}
                        <Switch
                          checked={ent.enabled}
                          disabled={togglingKey === ent.featureKey}
                          onCheckedChange={(v) =>
                            entPlan &&
                            toggleEntitlement(entPlan.id, ent.featureKey, v)
                          }
                        />
                        {/* Delete */}
                        <button
                          onClick={() =>
                            entPlan &&
                            deleteEntitlement(entPlan.id, ent.featureKey)
                          }
                          disabled={deletingKey === ent.featureKey}
                          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          title="Remove entitlement"
                        >
                          {deletingKey === ent.featureKey ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}

            <p className="text-xs text-muted-foreground text-center pt-2">
              {entitlements.length} entitlement
              {entitlements.length !== 1 ? "s" : ""} on this plan
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
