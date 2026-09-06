"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTrigger,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  SlidersHorizontal,
  AlertTriangle,
  Package,
  Coins,
  ArrowLeft,
  ToggleLeft,
  Hash,
  Copy,
  Check,
  Pencil,
  X,
  Loader2,
  ChevronRight,
  ChevronDown,
  Trash2,
  Search,
  List,
  Edit2,
  Edit,
  Puzzle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Skeleton,
  SkeletonTable,
  SkeletonCard,
  SkeletonMetricGrid,
  SkeletonList,
} from "@/components/ui/skeleton";
import { useEnvironment } from "@/contexts/environment-context";
import { FeatureAvatar } from "./features";
import { Web3Icon } from "@/components/web3-icon";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSignTypedData,
  useWalletClient,
} from "wagmi";
import { parseEventLogs } from "viem";
import {
  getUsdcAddress,
  getTokenOptions,
  getTokenOptionsForChain,
  getTokenOptionsForEnvironment,
} from "@/lib/contracts";
import type { TokenOption } from "@/lib/contracts";
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_TESTNET_CHAIN_ID,
  DEFAULT_MAINNET_CHAIN_ID,
  getChainLabel,
  isSupportedDashboardChainId,
  resolveEnvironmentChainId,
} from "@/lib/default-chain";
import { toast } from "sonner";
import { PlanFactoryABI, YEARLY_INTERVAL, isEvmChain } from "@arcenpay/internal-core";
import { contract as stellarContract } from "@stellar/stellar-sdk";
import {
  isSmartAccountInfrastructureError,
  sendSmartAccountTransaction,
} from "@arcenpay/react/smart-account";
import { useDashboardWallet } from "@/hooks/use-dashboard-wallet";
import { useStellarWallet } from "@/hooks/use-stellar-wallet";
import { useTeamTier } from "@/hooks/use-team-tier";

// ─── Types ────────────────────────────────────────────────────────────────────

type EnvMode = "DEVELOPMENT" | "PRODUCTION";
type CatalogStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

interface CatalogPlan {
  id: string;
  name: string;
  tier: string;
  description?: string | null;
  price: string;
  annualPrice?: string | null;
  billingInterval: number;
  acceptedToken: string;
  environmentMode: EnvMode;
  status: CatalogStatus;
  active: boolean;
  version: number;
  publishedAt?: string | null;
  updatedAt: string;
  chainSyncStatus?: "PENDING" | "SYNCED" | "FAILED" | "NOT_APPLICABLE";
  onChainPlanId?: string | null;
  chainSyncError?: string | null;
  chainId?: number | null;
  chainTxHash?: string | null;
}

interface CatalogAddOn {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  billingType: "ONE_TIME" | "RECURRING";
  saleMode: "STANDALONE" | "UPSELL" | "BOTH";
  price: string;
  billingIntervalDays?: number | null;
  acceptedToken: string;
  environmentMode: EnvMode;
  status: CatalogStatus;
  active: boolean;
  version: number;
  publishedAt?: string | null;
  updatedAt: string;
  purchaseUrl?: string | null;
}

interface CatalogCreditType {
  id: string;
  name: string;
  code: string;
  unitName: string;
  unitsPerPack: number;
  price: string;
  acceptedToken: string;
  metadata?: {
    description?: string | null;
    unitNamePlural?: string | null;
  } | null;
  environmentMode: EnvMode;
  status: CatalogStatus;
  active: boolean;
  version: number;
  publishedAt?: string | null;
  updatedAt: string;
}

interface PlanCompany {
  id: string;
  name: string;
  email?: string | null;
  walletAddress?: string | null;
  externalId?: string | null;
  activePlanId?: string | null;
  createdAt: string;
  lastSeenAt: string;
}

interface OwnerActionRequiredPayload {
  description?: string;
  target?: string;
  value?: string;
  data?: string;
  functionSignature?: string;
  args?: string[];
  safeTransaction?: {
    to: string;
    value: string;
    data: string;
    operation: number;
  };
}

interface RegisterOnChainResponse {
  txHash?: string;
  error?: string;
  relayerAddress?: string;
  planFactoryOwner?: string | null;
  ownerActionRequired?: OwnerActionRequiredPayload;
  providerAddress?: string;
  planOwner?: string;
  signingRequired?: boolean;
  noOp?: boolean;
  preparedTransaction?: {
    target: string;
    value?: string;
    data: string;
    executionMode?: "wallet" | "smart-account";
    functionSignature?: string;
  };
}

// ─── Token Options ────────────────────────────────────────────────────────────

const TOKEN_OPTIONS: TokenOption[] = getTokenOptions();

const BILLING_INTERVALS: { label: string; seconds: number; days: number; sublabel: string }[] = [
  { label: "Monthly", seconds: 2_592_000, days: 30, sublabel: "Every month" },
  { label: "Quarterly", seconds: 7_776_000, days: 90, sublabel: "Every 3 months" },
  { label: "Annual", seconds: 31_536_000, days: 365, sublabel: "Every year" },
];
const SECONDS_PER_DAY = 86_400;

function billingIntervalLabel(seconds: number): string {
  return BILLING_INTERVALS.find((interval) => interval.seconds === seconds)?.label ??
    `${Math.round(seconds / SECONDS_PER_DAY)} days`;
}

function tokenLabel(address: string): string {
  const match = TOKEN_OPTIONS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
  return match
    ? `${match.symbol} (${address.slice(0, 6)}…${address.slice(-4)})`
    : address.slice(0, 10) + "…";
}

function resolveMaxOnChainChargeMicros(plan: Pick<CatalogPlan, "price" | "annualPrice">): bigint {
  const monthlyMicros = Math.round(parseFloat(plan.price || "0") * 1_000_000);
  const annualMicros = Math.round(
    parseFloat(String(plan.annualPrice ?? "0")) * 1_000_000,
  );
  return BigInt(Math.max(monthlyMicros, annualMicros, 0));
}

function getInitialTokenForEnvironment(
  env: EnvMode,
  connectedChainId?: number,
  lockedChainId?: number,
): string {
  const resolvedChainId = lockedChainId ?? resolveEnvironmentChainId(env);
  const envTokens = lockedChainId
    ? getTokenOptionsForChain(lockedChainId)
    : getTokenOptionsForEnvironment(env);

  const preferredConnectedToken =
    connectedChainId && connectedChainId === resolvedChainId
      ? getUsdcAddress(connectedChainId)
      : null;

  if (
    preferredConnectedToken &&
    envTokens.some((token) => {
      // EVM addresses are case-insensitive hex; Stellar addresses are
      // base32 and case-sensitive (lowercasing corrupts them).
      if (isEvmChain(resolvedChainId)) {
        return token.address.toLowerCase() === preferredConnectedToken.toLowerCase();
      }
      return token.address === preferredConnectedToken;
    })
  ) {
    return preferredConnectedToken;
  }

  return envTokens[0]?.address ?? getUsdcAddress(resolvedChainId);
}

function isOwnerActionRequired(data: RegisterOnChainResponse): boolean {
  return Boolean(
    data.ownerActionRequired?.target && data.ownerActionRequired?.data,
  );
}

function formatOwnerActionMessage(data: RegisterOnChainResponse): string {
  const owner = data.planFactoryOwner
    ? ` Owner: ${data.planFactoryOwner}.`
    : "";
  const relayer = data.relayerAddress
    ? ` Relayer: ${data.relayerAddress}.`
    : "";
  return `Plan saved. Multisig owner action required to register provider.${owner}${relayer}`;
}

async function copyOwnerActionPayload(
  data: RegisterOnChainResponse,
): Promise<void> {
  if (!data.ownerActionRequired) return;
  try {
    await navigator.clipboard.writeText(
      JSON.stringify(
        {
          relayerAddress: data.relayerAddress,
          planFactoryOwner: data.planFactoryOwner,
          ownerActionRequired: data.ownerActionRequired,
        },
        null,
        2,
      ),
    );
    toast.message("Safe payload copied to clipboard");
  } catch {
    // Ignore clipboard errors (unsupported contexts, denied permission, etc.)
  }
}

async function fetchSmartAccountConfig(chainId: number): Promise<{
  provider?: "pimlico";
  bundlerUrl: string;
  paymasterUrl: string;
} | null> {
  const candidateRoutes = ["/api/v1/public/smart-account-config"];
  const candidateQueries = [
    `chainId=${chainId}&selfFunded=true`,
    `chainId=${chainId}`,
  ];

  try {
    for (const route of candidateRoutes) {
      for (const query of candidateQueries) {
        const res = await fetch(`${route}?${query}`);
        if (!res.ok) {
          const detail = await res
            .json()
            .catch(() => ({} as { error?: string }));
          console.warn("[catalog] Smart-account config request failed", {
            chainId,
            route,
            query,
            status: res.status,
            error: detail?.error ?? `HTTP ${res.status}`,
          });
          continue;
        }

        const body = (await res.json().catch(() => ({}))) as {
          data?: {
            provider?: "pimlico";
            bundlerUrl?: string;
            paymasterUrl?: string;
          };
        };

        if (body.data?.bundlerUrl && body.data?.paymasterUrl) {
          return {
            provider: body.data.provider,
            bundlerUrl: body.data.bundlerUrl,
            paymasterUrl: body.data.paymasterUrl,
          };
        }
      }
    }
  } catch (error) {
    console.warn("[catalog] Smart-account config request threw", {
      chainId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return null;
}

function formatSmartAccountProviderLabel(provider?: "pimlico") {
  if (provider === "pimlico") return "Pimlico";
  return "Smart account";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<
  CatalogStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  DRAFT: "secondary",
  PUBLISHED: "default",
  ARCHIVED: "outline",
};

function StatusBadge({ status }: { status: CatalogStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>;
}

function EnvBadge({ mode }: { mode: EnvMode }) {
  return (
    <Badge
      variant="outline"
      className={
        mode === "PRODUCTION"
          ? "border-orange-400 text-foreground"
          : "border-blue-400 text-foreground"
      }
    >
      {mode === "PRODUCTION" ? "PROD" : "DEV"}
    </Badge>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-secondary/5 px-4 py-8 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

const NEXT_STATUS: Partial<Record<CatalogStatus, CatalogStatus[]>> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
};

function statusActionLabel(status: CatalogStatus): string {
  if (status === "PUBLISHED") return "Publish";
  if (status === "ARCHIVED") return "Archive";
  return status;
}

// ─── Publish Summary Dialog ────────────────────────────────────────────────────

type ChainSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "NOT_APPLICABLE";

function ChainSyncBadge({ status }: { status: ChainSyncStatus }) {
  if (status === "SYNCED")
    return (
      <Badge variant="default" className="bg-green-600 text-white text-xs">
        On-chain
      </Badge>
    );
  if (status === "PENDING")
    return (
      <Badge
        variant="secondary"
        className="text-warning border-border text-xs"
      >
        Needs sync
      </Badge>
    );
  if (status === "FAILED")
    return (
      <Badge variant="destructive" className="text-xs">
        Sync failed
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Off-chain
    </Badge>
  );
}

// ─── Create Plan Dialog ────────────────────────────────────────────────────────

function CreatePlanDialog({
  env,
  onCreated,
}: {
  env: EnvMode;
  onCreated: () => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  const lockedChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(env);
  const envTokens = getTokenOptionsForChain(lockedChainId);
  const initialAcceptedToken = getInitialTokenForEnvironment(
    env,
    chainId,
    lockedChainId,
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planType, setPlanType] = useState<"free" | "paid">("paid");
  const [billingIntervalDays, setBillingIntervalDays] = useState(2_592_000);
  const [hasAnnualPrice, setHasAnnualPrice] = useState(false);
  const [annualDiscount, setAnnualDiscount] = useState("20");
  const [form, setForm] = useState({
    name: "",
    tier: "",
    description: "",
    price: "",
    annualPrice: "",
    acceptedToken: initialAcceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive tier from name (lowercase slug)
  const autoTier = form.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (planType === "paid") {
      const p = Number(form.price);
      if (!form.price || isNaN(p) || p <= 0)
        e.price = "Must be a positive number";
      if (hasAnnualPrice) {
        const ap = Number(form.annualPrice);
        if (!form.annualPrice || isNaN(ap) || ap <= 0)
          e.annualPrice = "Must be a positive number";
      }
    }
    return e;
  }

  function resetForm() {
    setPlanType("paid");
    setBillingIntervalDays(2_592_000);
    setHasAnnualPrice(false);
    setAnnualDiscount("20");
    setForm({
      name: "",
      tier: "",
      description: "",
      price: "",
      annualPrice: "",
      acceptedToken: initialAcceptedToken,
    });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          tier: form.tier.trim() || autoTier || "base",
          description: form.description || undefined,
          price: planType === "free" ? 0 : Number(form.price),
          ...(planType === "paid" && hasAnnualPrice && form.annualPrice
            ? { annualPrice: Number(form.annualPrice) }
            : {}),
          billingInterval: billingIntervalDays,
          acceptedToken: form.acceptedToken,
          chainId: selectedChainOpt?.chainId,
          environmentMode: env,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to create plan" });
        return;
      }
      toast.success("Plan created — register it on-chain to activate.");
      setOpen(false);
      resetForm();
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  const selectedChainOpt = envTokens.find(
    (o) => o.address === form.acceptedToken,
  );
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" />
          New Plan
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-4xl p-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div />
          <button
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Plan Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                Create Plan
              </p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0" />
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || (
                    <span className="font-normal text-muted-foreground">
                      Untitled plan
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">
                Plan Preview
              </p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">
                    {form.name || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {form.description || form.name || "—"}
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {planType === "free"
                      ? "Free"
                      : form.price
                        ? `$${form.price} USDC`
                        : "—"}
                    {planType === "paid" && form.price && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        /{" "}
                        {BILLING_INTERVALS.find(
                          (i) => i.seconds === billingIntervalDays,
                        )?.label.toLowerCase() ?? "custom"}
                      </span>
                    )}
                  </p>
                  {hasAnnualPrice && form.annualPrice && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      or ${form.annualPrice} USDC / year
                      {form.price &&
                        Number(form.annualPrice) < Number(form.price) * 12 && (
                          <span className="text-foreground ml-1">
                            (save{" "}
                            {Math.round(
                              (1 -
                                Number(form.annualPrice) /
                                  (Number(form.price) * 12)) *
                                100,
                            )}
                            %)
                          </span>
                        )}
                    </p>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No entitlements yet
                  </p>
                </div>
                <div className="px-4 pb-4">
                  <button className="w-full py-2.5 rounded-lg bg-secondary border border-border text-sm font-medium text-muted-foreground cursor-default">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Settings ── */}
          <div className="flex-1 overflow-y-auto">
            <form id="create-plan-form" onSubmit={handleSubmit}>
              <div className="p-6 space-y-8">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">
                      Plan Settings
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    A company can only have one base plan.
                  </p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-secondary border border-border">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Name + Tier */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Name *
                    </Label>
                    <Input
                      value={form.name}
                      onChange={(e) => {
                        setForm({ ...form, name: e.target.value });
                        setErrors((p) => ({ ...p, name: "" }));
                      }}
                      placeholder="e.g. Pro, Starter, Enterprise"
                      className="h-11 bg-background border-border"
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive mt-1">
                        {errors.name}
                      </p>
                    )}
                  </div>
                  <div className="w-28">
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Tier
                      <span className="text-muted-foreground font-normal ml-1">
                        (auto)
                      </span>
                    </Label>
                    <Input
                      value={form.tier || autoTier}
                      onChange={(e) =>
                        setForm({ ...form, tier: e.target.value })
                      }
                      placeholder={autoTier || "pro"}
                      className="h-11 bg-background border-border font-mono text-sm"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Description
                  </Label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Describe this plan"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Optional
                  </p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">
                      Pricing
                    </h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary text-warning border border-border">
                      {env === "DEVELOPMENT" ? "DEV" : "PROD"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">
                    Set a price or keep it free.
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Type
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                          >
                            <span className="font-medium">
                              {planType === "free" ? "Free" : "Paid"}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem
                            onClick={() => {
                              setPlanType("free");
                              setForm((p) => ({ ...p, price: "" }));
                            }}
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">Free</p>
                              <p className="text-xs text-muted-foreground">
                                No charge — $0.00 USDC
                              </p>
                            </div>
                            {planType === "free" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPlanType("paid")}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Paid</p>
                              <p className="text-xs text-muted-foreground">
                                Recurring USDC payment
                              </p>
                            </div>
                            {planType === "paid" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Billing Integration
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt
                                  ? chainName(selectedChainOpt)
                                  : "Select token"}
                              </span>
                              {selectedChainOpt && (
                                <span
                                  className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-secondary text-success" : "bg-secondary text-muted-foreground border border-border"}`}
                                >
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">
                                  Connected
                                </span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {envTokens.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Testnets
                                </p>
                              </div>
                              {envTokens.filter(
                                (o) => o.tag === "testnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={false}
                                    onClick={() =>
                                      setForm((p) => ({
                                        ...p,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                        <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                      )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {envTokens.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Mainnets
                                </p>
                              </div>
                              {envTokens.filter(
                                (o) => o.tag === "mainnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={false}
                                    onClick={() =>
                                      setForm((p) => ({
                                        ...p,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                        <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                      )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">
                              This environment only supports its configured chain.
                            </p>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Paid-only: Price + Interval */}
                  {planType === "paid" && (
                    <>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Price per billing period (USDC) *
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                              $
                            </span>
                            <Input
                              value={form.price}
                              onChange={(e) => {
                                setForm({ ...form, price: e.target.value });
                                setErrors((p) => ({ ...p, price: "" }));
                              }}
                              placeholder="29.00"
                              type="number"
                              min="0.01"
                              step="0.01"
                              className="h-11 bg-background border-border pl-6"
                            />
                          </div>
                          {errors.price && (
                            <p className="text-xs text-destructive mt-1">
                              {errors.price}
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Billing Interval
                          </Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                              >
                                <span className="font-medium">
                                  {BILLING_INTERVALS.find(
                                    (i) => i.seconds === billingIntervalDays,
                                  )?.label ?? "Custom interval"}
                                </span>
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                              {BILLING_INTERVALS.map((iv) => (
                                <DropdownMenuItem
                                  key={iv.seconds}
                                  onClick={() =>
                                    {
                                      setBillingIntervalDays(iv.seconds);
                                      if (iv.seconds === YEARLY_INTERVAL) {
                                        setHasAnnualPrice(false);
                                        setForm((p) => ({ ...p, annualPrice: "" }));
                                      }
                                    }
                                  }
                                  className="flex items-center justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {iv.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {iv.sublabel}
                                    </p>
                                  </div>
                                  {billingIntervalDays === iv.seconds && (
                                    <Check className="w-4 h-4 text-foreground ml-2" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {/* Annual pricing toggle */}
                      <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Annual Pricing
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Optional discounted rate for yearly subscribers
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={hasAnnualPrice}
                            aria-disabled={billingIntervalDays === YEARLY_INTERVAL}
                            disabled={billingIntervalDays === YEARLY_INTERVAL}
                            onClick={() => {
                              const next = !hasAnnualPrice;
                              setHasAnnualPrice(next);
                              if (!next) {
                                setForm((p) => ({ ...p, annualPrice: "" }));
                              } else if (form.price) {
                                // Auto-seed 20% discount on enable
                                const computed = (
                                  Number(form.price) *
                                  12 *
                                  0.8
                                ).toFixed(2);
                                setForm((p) => ({
                                  ...p,
                                  annualPrice: computed,
                                }));
                                setAnnualDiscount("20");
                              }
                            }}
                            className={cn(
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                              billingIntervalDays === YEARLY_INTERVAL &&
                                "cursor-not-allowed opacity-50",
                              hasAnnualPrice ? "bg-primary" : "bg-secondary",
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                                hasAnnualPrice
                                  ? "translate-x-5"
                                  : "translate-x-0",
                              )}
                            />
                          </button>
                        </div>
                        {hasAnnualPrice && (
                          <div className="mt-4 space-y-3">
                            {/* Discount % row */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">
                                  Discount off monthly × 12
                                </Label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min="0"
                                    max="60"
                                    step="1"
                                    value={annualDiscount}
                                    onChange={(e) => {
                                      const pct = e.target.value;
                                      setAnnualDiscount(pct);
                                      if (form.price) {
                                        const computed = (
                                          Number(form.price) *
                                          12 *
                                          (1 - Number(pct) / 100)
                                        ).toFixed(2);
                                        setForm((p) => ({
                                          ...p,
                                          annualPrice: computed,
                                        }));
                                        setErrors((p) => ({
                                          ...p,
                                          annualPrice: "",
                                        }));
                                      }
                                    }}
                                    className="flex-1 h-1.5 accent-primary cursor-pointer"
                                  />
                                  <div className="flex items-center gap-0.5 w-16 h-9 rounded-md border border-border bg-background px-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max="60"
                                      value={annualDiscount}
                                      onChange={(e) => {
                                        const pct = Math.min(
                                          60,
                                          Math.max(
                                            0,
                                            Number(e.target.value) || 0,
                                          ),
                                        ).toString();
                                        setAnnualDiscount(pct);
                                        if (form.price) {
                                          const computed = (
                                            Number(form.price) *
                                            12 *
                                            (1 - Number(pct) / 100)
                                          ).toFixed(2);
                                          setForm((p) => ({
                                            ...p,
                                            annualPrice: computed,
                                          }));
                                          setErrors((p) => ({
                                            ...p,
                                            annualPrice: "",
                                          }));
                                        }
                                      }}
                                      className="w-full text-sm text-foreground bg-transparent outline-none"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      %
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Computed annual price + override */}
                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">
                                  Annual price (USDC)
                                </Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                                    $
                                  </span>
                                  <Input
                                    value={form.annualPrice}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setForm({ ...form, annualPrice: val });
                                      setErrors((p) => ({
                                        ...p,
                                        annualPrice: "",
                                      }));
                                      // Back-calculate discount
                                      if (
                                        form.price &&
                                        val &&
                                        Number(val) > 0
                                      ) {
                                        const backPct = Math.round(
                                          (1 -
                                            Number(val) /
                                              (Number(form.price) * 12)) *
                                            100,
                                        );
                                        if (backPct >= 0 && backPct <= 60)
                                          setAnnualDiscount(String(backPct));
                                      }
                                    }}
                                    placeholder={
                                      form.price
                                        ? (
                                            Number(form.price) *
                                            12 *
                                            0.8
                                          ).toFixed(2)
                                        : "278.40"
                                    }
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    className="h-9 bg-background border-border pl-6 text-sm"
                                  />
                                </div>
                                {errors.annualPrice && (
                                  <p className="text-xs text-destructive mt-1">
                                    {errors.annualPrice}
                                  </p>
                                )}
                              </div>

                              {form.price &&
                                form.annualPrice &&
                                Number(form.annualPrice) > 0 && (
                                  <div className="pt-6 text-right">
                                    <p className="text-xs font-semibold text-foreground">
                                      {Math.round(
                                        (1 -
                                          Number(form.annualPrice) /
                                            (Number(form.price) * 12)) *
                                          100,
                                      )}
                                      % off
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      vs ${(Number(form.price) * 12).toFixed(2)}
                                      /yr
                                    </p>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Environment: <strong>{env}</strong> — plan will be created in
                  the catalog. Click &ldquo;Register on-chain&rdquo; after
                  creation to activate it on-chain.
                </p>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            form="create-plan-form"
            type="submit"
            disabled={loading}
            className="min-w-[140px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create Add-On Dialog ──────────────────────────────────────────────────────

function CreateAddOnDialog({
  env,
  onCreated,
}: {
  env: EnvMode;
  onCreated: () => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  const lockedChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(env);
  const envTokens = getTokenOptionsForChain(lockedChainId);
  const initialAcceptedToken = getInitialTokenForEnvironment(
    env,
    chainId,
    lockedChainId,
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [billingIntervalDays, setBillingIntervalDays] = useState(30);
  const [form, setForm] = useState({
    name: "",
    description: "",
    billingType: "ONE_TIME" as "ONE_TIME" | "RECURRING",
    saleMode: "STANDALONE" as "STANDALONE" | "UPSELL" | "BOTH",
    price: "",
    acceptedToken: initialAcceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive code from name
  const autoCode = form.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const selectedChainOpt = envTokens.find(
    (o) => o.address === form.acceptedToken,
  );
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    return e;
  }

  function resetForm() {
    setBillingIntervalDays(30);
    setForm({
      name: "",
      description: "",
      billingType: "ONE_TIME",
      saleMode: "STANDALONE",
      price: "",
      acceptedToken: initialAcceptedToken,
    });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/add-ons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: autoCode || "add-on",
          description: form.description || undefined,
          billingType: form.billingType,
          saleMode: form.saleMode,
          billingIntervalDays:
            form.billingType === "RECURRING" ? billingIntervalDays : undefined,
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
          environmentMode: env,
        }),
      });
      if (res.ok) {
        toast.success("Add-on created");
        setOpen(false);
        resetForm();
        onCreated();
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to create add-on" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" />
          New Add-On
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-4xl p-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div />
          <button
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Add-On Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                Create Add-On
              </p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0" />
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || (
                    <span className="font-normal text-muted-foreground">
                      Untitled add-on
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">
                Add-On Preview
              </p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">
                    {form.name || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {form.description || "No description"}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <p className="text-sm font-semibold text-foreground">
                      {form.price ? `$${form.price} USDC` : "—"}
                    </p>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {form.billingType === "ONE_TIME"
                        ? "One-time"
                        : "Recurring"}
                    </span>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-foreground">
                      {form.saleMode === "STANDALONE"
                        ? "Standalone"
                        : form.saleMode === "UPSELL"
                          ? "Upsell"
                          : "Standalone + upsell"}
                    </span>
                  </div>
                  {form.billingType === "RECURRING" && form.price && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      /{" "}
                      {BILLING_INTERVALS.find(
                        (i) => i.days === billingIntervalDays,
                      )?.label.toLowerCase() ?? `${billingIntervalDays}d`}
                    </p>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No entitlements yet
                  </p>
                </div>
                <div className="px-4 pb-4">
                  <button className="w-full py-2.5 rounded-lg bg-secondary border border-border text-sm font-medium text-muted-foreground cursor-default">
                    Purchase
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Settings ── */}
          <div className="flex-1 overflow-y-auto">
            <form id="create-addon-form" onSubmit={handleSubmit}>
              <div className="p-6 space-y-8">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">
                      Add-On Settings
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Additional features customers can purchase alongside plans.
                  </p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-secondary border border-border">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Name */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Name *
                  </Label>
                  <Input
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      setErrors((p) => ({ ...p, name: "" }));
                    }}
                    placeholder="e.g. Extra Storage, Priority Support"
                    className="h-11 bg-background border-border"
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive mt-1">
                      {errors.name}
                    </p>
                  )}
                  {autoCode && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Code: <span className="font-mono">{autoCode}</span>
                    </p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Description
                  </Label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Describe what this add-on provides"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Optional
                  </p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">
                      Pricing
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">
                    Configure billing for this add-on
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Type
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                          >
                            <span className="font-medium">
                              {form.billingType === "ONE_TIME"
                                ? "One-time"
                                : "Recurring"}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem
                            onClick={() =>
                              setForm((p) => ({
                                ...p,
                                billingType: "ONE_TIME",
                              }))
                            }
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">One-time</p>
                              <p className="text-xs text-muted-foreground">
                                Single charge purchase
                              </p>
                            </div>
                            {form.billingType === "ONE_TIME" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setForm((p) => ({
                                ...p,
                                billingType: "RECURRING",
                                saleMode: "UPSELL",
                              }))
                            }
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">Recurring</p>
                              <p className="text-xs text-muted-foreground">
                                Billed on a schedule
                              </p>
                            </div>
                            {form.billingType === "RECURRING" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Sell As
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                          >
                            <span className="font-medium">
                              {form.saleMode === "STANDALONE"
                                ? "Standalone checkout"
                                : form.saleMode === "UPSELL"
                                  ? "Subscriber upsell"
                                  : "Standalone + upsell"}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem
                            onClick={() =>
                              setForm((p) => ({
                                ...p,
                                saleMode: "STANDALONE",
                                billingType: "ONE_TIME",
                              }))
                            }
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                Standalone checkout
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Sell with a hosted one-time payment link
                              </p>
                            </div>
                            {form.saleMode === "STANDALONE" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setForm((p) => ({ ...p, saleMode: "UPSELL" }))
                            }
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">
                                Subscriber upsell
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Attach to existing customers or recurring
                                subscriptions
                              </p>
                            </div>
                            {form.saleMode === "UPSELL" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                          {form.billingType === "ONE_TIME" && (
                            <DropdownMenuItem
                              onClick={() =>
                                setForm((p) => ({ ...p, saleMode: "BOTH" }))
                              }
                            >
                              <div className="flex-1">
                                <p className="text-sm font-medium">
                                  Standalone + upsell
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Offer a pay link and allow manual assignment
                                </p>
                              </div>
                              {form.saleMode === "BOTH" && (
                                <Check className="w-4 h-4 ml-2 text-foreground" />
                              )}
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {form.billingType === "RECURRING" && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Recurring add-ons are limited to subscriber upsells
                          for this launch.
                        </p>
                      )}
                    </div>

                    {/* Billing Integration */}
                    <div className="col-span-2">
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Billing Integration
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt
                                  ? chainName(selectedChainOpt)
                                  : "Select token"}
                              </span>
                              {selectedChainOpt && (
                                <span
                                  className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-secondary text-success" : "bg-secondary text-muted-foreground border border-border"}`}
                                >
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">
                                  Connected
                                </span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {envTokens.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Testnets
                                </p>
                              </div>
                              {envTokens.filter(
                                (o) => o.tag === "testnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={!isConn}
                                    onClick={() =>
                                      isConn &&
                                      setForm((p) => ({
                                        ...p,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                        <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                      )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {envTokens.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Mainnets
                                </p>
                              </div>
                              {envTokens.filter(
                                (o) => o.tag === "mainnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={!isConn}
                                    onClick={() =>
                                      isConn &&
                                      setForm((p) => ({
                                        ...p,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                        <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                      )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">
                              This environment only supports its configured chain.
                            </p>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-foreground mb-2 block">
                          Price (USDC) *
                        </Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                            $
                          </span>
                          <Input
                            value={form.price}
                            onChange={(e) => {
                              setForm({ ...form, price: e.target.value });
                              setErrors((p) => ({ ...p, price: "" }));
                            }}
                            placeholder="9.99"
                            type="number"
                            min="0.01"
                            step="0.01"
                            className="h-11 bg-background border-border pl-6"
                          />
                        </div>
                        {errors.price && (
                          <p className="text-xs text-destructive mt-1">
                            {errors.price}
                          </p>
                        )}
                      </div>

                      {/* Recurring: billing interval */}
                      {form.billingType === "RECURRING" && (
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Billing Interval
                          </Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                              >
                                <span className="font-medium">
                                  {BILLING_INTERVALS.find(
                                    (i) => i.days === billingIntervalDays,
                                  )?.label ?? `${billingIntervalDays} days`}
                                </span>
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                              {BILLING_INTERVALS.map((iv) => (
                                <DropdownMenuItem
                                  key={iv.days}
                                  onClick={() =>
                                    setBillingIntervalDays(iv.days)
                                  }
                                  className="flex items-center justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {iv.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {iv.sublabel}
                                    </p>
                                  </div>
                                  {billingIntervalDays === iv.days && (
                                    <Check className="w-4 h-4 text-foreground ml-2" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            form="create-addon-form"
            type="submit"
            disabled={loading}
            className="min-w-[140px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Create Credit Type Dialog ─────────────────────────────────────────────────

function CreateCreditTypeDialog({
  env,
  onCreated,
}: {
  env: EnvMode;
  onCreated: () => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  const lockedChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(env);
  const envTokens = getTokenOptionsForChain(lockedChainId);
  const initialAcceptedToken = getInitialTokenForEnvironment(
    env,
    chainId,
    lockedChainId,
  );

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    unitNameSingle: "",
    unitNamePlural: "",
    unitsPerPack: "100",
    price: "",
    acceptedToken: initialAcceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive code from name
  const autoCode = form.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");

  const selectedChainOpt = envTokens.find(
    (o) => o.address === form.acceptedToken,
  );
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.unitNameSingle.trim()) e.unitNameSingle = "Required";
    const upp = Number(form.unitsPerPack);
    if (!form.unitsPerPack || isNaN(upp) || upp <= 0 || !Number.isInteger(upp))
      e.unitsPerPack = "Must be a positive integer";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    return e;
  }

  function resetForm() {
    setForm({
      name: "",
      description: "",
      unitNameSingle: "",
      unitNamePlural: "",
      unitsPerPack: "100",
      price: "",
      acceptedToken: initialAcceptedToken,
    });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const unitName = form.unitNameSingle.trim();
      const res = await fetch("/api/catalog/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: autoCode || "credit",
          description: form.description || undefined,
          unitName,
          unitNamePlural: form.unitNamePlural || undefined,
          unitsPerPack: Number(form.unitsPerPack),
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
          environmentMode: env,
        }),
      });
      if (res.ok) {
        toast.success("Credit type created");
        setOpen(false);
        resetForm();
        onCreated();
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to create credit type" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetForm();
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" />
          New Credit Type
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-4xl p-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div />
          <button
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Credit Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                Create Credit Type
              </p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0 flex items-center justify-center">
                  <Coins className="w-4 h-4 text-white" />
                </div>
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || (
                    <span className="font-normal text-muted-foreground">
                      Untitled credit type
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">
                Credit Preview
              </p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">
                    {form.name || "—"}
                  </p>
                  {form.unitNameSingle && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Unit:{" "}
                      <span className="font-medium">{form.unitNameSingle}</span>
                      {form.unitNamePlural && ` / ${form.unitNamePlural}`}
                    </p>
                  )}
                  {form.unitsPerPack && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {form.unitsPerPack} {form.unitNameSingle || "units"} per
                      pack
                    </p>
                  )}
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {form.price ? `$${form.price} USDC` : "—"}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      / pack
                    </span>
                  </p>
                </div>
                <div className="px-4 pb-4 pt-3">
                  <button className="w-full py-2.5 rounded-lg bg-secondary border border-border text-sm font-medium text-muted-foreground cursor-default">
                    Purchase Credits
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Settings ── */}
          <div className="flex-1 overflow-y-auto">
            <form id="create-credit-form" onSubmit={handleSubmit}>
              <div className="p-6 space-y-8">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">
                      Credit Type Settings
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Define a consumable unit for usage-based billing.
                  </p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-secondary border border-border">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Credit name */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Credit name *
                  </Label>
                  <Input
                    value={form.name}
                    onChange={(e) => {
                      setForm({ ...form, name: e.target.value });
                      setErrors((p) => ({ ...p, name: "" }));
                    }}
                    placeholder="e.g. API Calls, Storage GB"
                    className="h-11 bg-background border-border"
                  />
                  {errors.name && (
                    <p className="text-xs text-destructive mt-1">
                      {errors.name}
                    </p>
                  )}
                  {autoCode && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Code: <span className="font-mono">{autoCode}</span>
                    </p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Description
                  </Label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Optional, displayed in components"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Optional, displayed in components
                  </p>
                </div>

                {/* Unit names */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">
                    Unit Names
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Single unit name *
                        <span className="text-muted-foreground font-normal ml-1 text-xs">
                          (A single…)
                        </span>
                      </Label>
                      <Input
                        value={form.unitNameSingle}
                        onChange={(e) => {
                          setForm({ ...form, unitNameSingle: e.target.value });
                          setErrors((p) => ({ ...p, unitNameSingle: "" }));
                        }}
                        placeholder="call, gigabyte, credit"
                        className="h-11 bg-background border-border"
                      />
                      {errors.unitNameSingle && (
                        <p className="text-xs text-destructive mt-1">
                          {errors.unitNameSingle}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Multiple unit name
                        <span className="text-muted-foreground font-normal ml-1 text-xs">
                          (Many…)
                        </span>
                      </Label>
                      <Input
                        value={form.unitNamePlural}
                        onChange={(e) =>
                          setForm({ ...form, unitNamePlural: e.target.value })
                        }
                        placeholder="calls, gigabytes, credits"
                        className="h-11 bg-background border-border"
                      />
                    </div>
                  </div>
                </div>

                {/* Pack config */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">
                    Pack Configuration
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Units per pack *
                      </Label>
                      <Input
                        value={form.unitsPerPack}
                        onChange={(e) => {
                          setForm({ ...form, unitsPerPack: e.target.value });
                          setErrors((p) => ({ ...p, unitsPerPack: "" }));
                        }}
                        placeholder="100"
                        type="number"
                        min="1"
                        className="h-11 bg-background border-border"
                      />
                      {errors.unitsPerPack && (
                        <p className="text-xs text-destructive mt-1">
                          {errors.unitsPerPack}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1.5">
                        How many credits per purchase
                      </p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Price (USDC) *
                      </Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                          $
                        </span>
                        <Input
                          value={form.price}
                          onChange={(e) => {
                            setForm({ ...form, price: e.target.value });
                            setErrors((p) => ({ ...p, price: "" }));
                          }}
                          placeholder="5.00"
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="h-11 bg-background border-border pl-6"
                        />
                      </div>
                      {errors.price && (
                        <p className="text-xs text-destructive mt-1">
                          {errors.price}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Billing Integration */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Billing Integration
                  </Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {selectedChainOpt
                              ? chainName(selectedChainOpt)
                              : "Select token"}
                          </span>
                          {selectedChainOpt && (
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-secondary text-success" : "bg-secondary text-muted-foreground border border-border"}`}
                            >
                              {selectedChainOpt.tag}
                            </span>
                          )}
                          {selectedChainOpt?.chainId === chainId && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">
                              Connected
                            </span>
                          )}
                        </div>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-80">
                      {envTokens.some((o) => o.tag === "testnet") && (
                        <>
                          <div className="px-2 pt-2 pb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Testnets
                            </p>
                          </div>
                          {envTokens.filter((o) => o.tag === "testnet").map(
                            (opt) => {
                              const isConn = opt.chainId === chainId;
                              return (
                                <DropdownMenuItem
                                  key={opt.chainId}
                                  disabled={!isConn}
                                  onClick={() =>
                                    isConn &&
                                    setForm((p) => ({
                                      ...p,
                                      acceptedToken: opt.address,
                                    }))
                                  }
                                  className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium">
                                          {chainName(opt)}
                                        </p>
                                        {isConn && (
                                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                            Connected
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                        {opt.symbol} · {opt.address.slice(0, 6)}
                                        …{opt.address.slice(-4)}
                                      </p>
                                    </div>
                                  </div>
                                  {form.acceptedToken === opt.address &&
                                    isConn && (
                                      <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                    )}
                                  {!isConn && (
                                    <span className="text-[9px] text-muted-foreground shrink-0">
                                      Switch wallet
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              );
                            },
                          )}
                        </>
                      )}
                      {envTokens.some((o) => o.tag === "mainnet") && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="px-2 pt-2 pb-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Mainnets
                            </p>
                          </div>
                          {envTokens.filter((o) => o.tag === "mainnet").map(
                            (opt) => {
                              const isConn = opt.chainId === chainId;
                              return (
                                <DropdownMenuItem
                                  key={opt.chainId}
                                  disabled={!isConn}
                                  onClick={() =>
                                    isConn &&
                                    setForm((p) => ({
                                      ...p,
                                      acceptedToken: opt.address,
                                    }))
                                  }
                                  className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-medium">
                                          {chainName(opt)}
                                        </p>
                                        {isConn && (
                                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                            Connected
                                          </span>
                                        )}
                                      </div>
                                      <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                        {opt.symbol} · {opt.address.slice(0, 6)}
                                        …{opt.address.slice(-4)}
                                      </p>
                                    </div>
                                  </div>
                                  {form.acceptedToken === opt.address &&
                                    isConn && (
                                      <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                    )}
                                  {!isConn && (
                                    <span className="text-[9px] text-muted-foreground shrink-0">
                                      Switch wallet
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              );
                            },
                          )}
                        </>
                      )}
                      <div className="px-3 py-2 border-t border-border mt-1">
                        <p className="text-[10px] text-muted-foreground">
                          This environment only supports its configured chain.
                        </p>
                      </div>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            form="create-credit-form"
            type="submit"
            disabled={loading}
            className="min-w-[140px]"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Edit Add-On Dialog ─────────────────────────────────────────────────────────

function EditAddOnDialog({
  addon,
  onSaved,
}: {
  addon: CatalogAddOn;
  onSaved: () => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  const lockedChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(addon.environmentMode);
  const tokenOptions = getTokenOptionsForChain(lockedChainId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [billingIntervalDays, setBillingIntervalDays] = useState(
    addon.billingIntervalDays ?? 30,
  );
  const [form, setForm] = useState({
    name: addon.name,
    description: addon.description ?? "",
    billingType: addon.billingType,
    saleMode: addon.saleMode,
    price: String(parseFloat(addon.price)),
    acceptedToken: addon.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({
      name: addon.name,
      description: addon.description ?? "",
      billingType: addon.billingType,
      saleMode: addon.saleMode,
      price: String(parseFloat(addon.price)),
      acceptedToken: addon.acceptedToken,
    });
    setBillingIntervalDays(addon.billingIntervalDays ?? 30);
  }, [addon]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/add-ons", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: addon.id,
          name: form.name,
          description: form.description || null,
          billingType: form.billingType,
          saleMode: form.saleMode,
          billingIntervalDays:
            form.billingType === "RECURRING" ? billingIntervalDays : null,
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
        }),
      });
      if (res.ok) {
        toast.success("Add-on updated");
        setOpen(false);
        onSaved();
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to update add-on" });
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedChainOpt = tokenOptions.find(
    (o) => o.address === form.acceptedToken,
  );
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          Edit Add-On
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Edit Add-On</h2>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <form
            id="edit-addon-form"
            onSubmit={handleSubmit}
            className="p-6 space-y-6"
          >
            {errors._global && (
              <div className="p-3 rounded-lg bg-secondary border border-border">
                <p className="text-sm text-destructive">{errors._global}</p>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Add-on name *
              </Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setErrors((p) => ({ ...p, name: "" }));
                }}
                className="h-11 bg-background border-border"
              />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Description
              </Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="h-11 bg-background border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Billing Type
                </Label>
                <Select
                  value={form.billingType}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      billingType: v as "ONE_TIME" | "RECURRING",
                      ...(v === "RECURRING" && { saleMode: "UPSELL" as const }),
                    })
                  }
                >
                  <SelectTrigger className="h-11 bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONE_TIME">One Time</SelectItem>
                    <SelectItem value="RECURRING">Recurring</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Sale Mode
                </Label>
                <Select
                  value={form.saleMode}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      saleMode: v as "STANDALONE" | "UPSELL" | "BOTH",
                    })
                  }
                >
                  <SelectTrigger className="h-11 bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDALONE">Standalone</SelectItem>
                    <SelectItem value="UPSELL">Upsell</SelectItem>
                    <SelectItem value="BOTH">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.billingType === "RECURRING" && (
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Billing Interval (days)
                </Label>
                <Input
                  type="number"
                  min="1"
                  value={billingIntervalDays}
                  onChange={(e) =>
                    setBillingIntervalDays(Number(e.target.value) || 30)
                  }
                  className="h-11 bg-background border-border"
                />
              </div>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Price (USDC) *
              </Label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={form.price}
                onChange={(e) => {
                  setForm({ ...form, price: e.target.value });
                  setErrors((p) => ({ ...p, price: "" }));
                }}
                className="h-11 bg-background border-border"
              />
              {errors.price && (
                <p className="text-xs text-destructive mt-1">{errors.price}</p>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Accepted Token
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center justify-between w-full h-11 px-3 rounded-lg bg-background border border-border text-sm hover:border-ring/50 transition-colors"
                  >
                    {selectedChainOpt ? (
                      <div className="flex items-center gap-2.5">
                        <Web3Icon chainId={selectedChainOpt.chainId} size="sm" />
                        <div className="text-left">
                          <p className="text-sm font-medium leading-none">
                            {chainName(selectedChainOpt)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {selectedChainOpt.symbol} ·{" "}
                            {selectedChainOpt.address.slice(0, 6)}…
                            {selectedChainOpt.address.slice(-4)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Select token</span>
                    )}
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
                  {tokenOptions.map((o) => (
                    <DropdownMenuItem
                      key={o.address}
                      onClick={() =>
                        setForm({ ...form, acceptedToken: o.address })
                      }
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[11px] font-bold">
                          {chainInitial(o)}
                        </span>
                        <div className="text-left">
                          <p className="text-sm font-medium">{chainName(o)}</p>
                          <p className="text-xs text-muted-foreground font-mono">
                            {o.symbol}
                          </p>
                        </div>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </form>
        </div>

        <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-addon-form" disabled={loading}>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            ) : null}
            Save Changes
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Edit Credit Type Dialog ────────────────────────────────────────────────────

function EditCreditTypeDialog({
  credit,
  onSaved,
}: {
  credit: CatalogCreditType;
  onSaved: () => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  const lockedChainId =
    activeEnvironment?.chainId ?? resolveEnvironmentChainId(credit.environmentMode);
  const tokenOptions = getTokenOptionsForChain(lockedChainId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: credit.name,
    description: credit.metadata?.description ?? "",
    unitNameSingle: credit.unitName,
    unitNamePlural: credit.metadata?.unitNamePlural ?? "",
    unitsPerPack: String(credit.unitsPerPack),
    price: String(parseFloat(credit.price)),
    acceptedToken: credit.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset when credit changes
  useEffect(() => {
    setForm({
      name: credit.name,
      description: credit.metadata?.description ?? "",
      unitNameSingle: credit.unitName,
      unitNamePlural: credit.metadata?.unitNamePlural ?? "",
      unitsPerPack: String(credit.unitsPerPack),
      price: String(parseFloat(credit.price)),
      acceptedToken: credit.acceptedToken,
    });
  }, [credit]);

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.unitNameSingle.trim()) e.unitNameSingle = "Required";
    const upp = Number(form.unitsPerPack);
    if (!form.unitsPerPack || isNaN(upp) || upp <= 0 || !Number.isInteger(upp))
      e.unitsPerPack = "Must be a positive integer";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: credit.id,
          name: form.name,
          description: form.description || null,
          unitName: form.unitNameSingle,
          unitNamePlural: form.unitNamePlural || null,
          unitsPerPack: Number(form.unitsPerPack),
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
        }),
      });
      if (res.ok) {
        toast.success("Credit type updated");
        setOpen(false);
        onSaved();
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to update credit type" });
      }
    } finally {
      setLoading(false);
    }
  }

  const selectedChainOpt = tokenOptions.find(
    (o) => o.address === form.acceptedToken,
  );
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          Edit Credit
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold">Edit Credit Type</h2>
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <form
            id="edit-credit-form"
            onSubmit={handleSubmit}
            className="p-6 space-y-6"
          >
            {errors._global && (
              <div className="p-3 rounded-lg bg-secondary border border-border">
                <p className="text-sm text-destructive">{errors._global}</p>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Credit name *
              </Label>
              <Input
                value={form.name}
                onChange={(e) => {
                  setForm({ ...form, name: e.target.value });
                  setErrors((p) => ({ ...p, name: "" }));
                }}
                className="h-11 bg-background border-border"
              />
              {errors.name && (
                <p className="text-xs text-destructive mt-1">{errors.name}</p>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Description
              </Label>
              <Input
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder="Optional, displayed in customer components"
                className="h-11 bg-background border-border"
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Unit name (singular) *
              </Label>
              <Input
                value={form.unitNameSingle}
                onChange={(e) => {
                  setForm({ ...form, unitNameSingle: e.target.value });
                  setErrors((p) => ({ ...p, unitNameSingle: "" }));
                }}
                placeholder="e.g. credit, call, token"
                className="h-11 bg-background border-border"
              />
              {errors.unitNameSingle && (
                <p className="text-xs text-destructive mt-1">
                  {errors.unitNameSingle}
                </p>
              )}
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Unit name (plural)
              </Label>
              <Input
                value={form.unitNamePlural}
                onChange={(e) =>
                  setForm({ ...form, unitNamePlural: e.target.value })
                }
                placeholder="e.g. credits, calls, tokens"
                className="h-11 bg-background border-border"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Units per pack *
                </Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.unitsPerPack}
                  onChange={(e) => {
                    setForm({ ...form, unitsPerPack: e.target.value });
                    setErrors((p) => ({ ...p, unitsPerPack: "" }));
                  }}
                  className="h-11 bg-background border-border"
                />
                {errors.unitsPerPack && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.unitsPerPack}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">
                  Price (USDC) *
                </Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => {
                    setForm({ ...form, price: e.target.value });
                    setErrors((p) => ({ ...p, price: "" }));
                  }}
                  placeholder="0.00"
                  className="h-11 bg-background border-border"
                />
                {errors.price && (
                  <p className="text-xs text-destructive mt-1">
                    {errors.price}
                  </p>
                )}
              </div>
            </div>

            {/* Chain / Billing Integration */}
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Billing Integration
              </Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center justify-between w-full h-11 px-3 rounded-lg bg-background border border-border text-sm hover:border-ring/50 transition-colors"
                  >
                    {selectedChainOpt ? (
                      <div className="flex items-center gap-2.5">
                        <Web3Icon chainId={selectedChainOpt.chainId} size="sm" />
                        <div className="text-left">
                          <p className="text-sm font-medium leading-none">
                            {chainName(selectedChainOpt)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">
                            {selectedChainOpt.symbol} ·{" "}
                            {selectedChainOpt.address.slice(0, 6)}…
                            {selectedChainOpt.address.slice(-4)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">
                        Select token
                      </span>
                    )}
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="start">
                  {tokenOptions.map((opt) => {
                    const isConn = opt.chainId === chainId;
                    return (
                      <DropdownMenuItem
                        key={opt.chainId}
                        disabled={!isConn}
                        onClick={() =>
                          isConn &&
                          setForm((p) => ({ ...p, acceptedToken: opt.address }))
                        }
                        className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                          <div>
                            <p className="text-sm font-medium">
                              {chainName(opt)}
                            </p>
                            <p className="text-xs font-mono text-muted-foreground">
                              {opt.symbol} · {opt.address.slice(0, 6)}…
                              {opt.address.slice(-4)}
                            </p>
                          </div>
                        </div>
                        {form.acceptedToken === opt.address && isConn && (
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        )}
                        {!isConn && (
                          <span className="text-[9px] text-muted-foreground shrink-0">
                            Switch wallet
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </form>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            form="edit-credit-form"
            type="submit"
            disabled={loading}
            className="min-w-[120px]"
          >
            {loading ? (
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
  );
}

// ─── Plans Table ───────────────────────────────────────────────────────────────

function PlansTable({
  env,
  refresh,
  onSelect,
}: {
  env: EnvMode;
  refresh?: number;
  onSelect?: (plan: CatalogPlan) => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const { address, isConnected } = useAccount();
  const stellar = useStellarWallet(activeEnvironment?.chainId ?? 9_000_001);
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: chainId || DEFAULT_CHAIN_ID });
  const { signTypedDataAsync } = useSignTypedData();
  const { data: walletClient } = useWalletClient();

  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<CatalogPlan | null>(null);
  const [entTarget, setEntTarget] = useState<CatalogPlan | null>(null);
  const [safeDialogOpen, setSafeDialogOpen] = useState(false);
  const [safeDialogData, setSafeDialogData] = useState<{
    payload: OwnerActionRequiredPayload;
    planFactoryOwner: string | null;
    relayerAddress: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ environmentMode: env });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/catalog/plans?${params}`);
      if (res.ok) {
        const data = await res.json();
        setPlans(data.plans ?? []);
      } else {
        console.error("[PlansTable] Failed to load plans:", res.status, await res.text().catch(() => ""));
        setPlans([]);
      }
    } catch (err) {
      console.error("[PlansTable] Load error:", err);
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter, activeEnvironment?.id]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function updateStatus(id: string, status: CatalogStatus) {
    setUpdating(id);
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) load();
    } finally {
      setUpdating(null);
    }
  }

  async function registerOnChain(plan: CatalogPlan) {
    const planChainId = plan.chainId ?? activeEnvironment?.chainId ?? 0;
    const isEvmPlan = isEvmChain(planChainId);

    if (isEvmPlan) {
      if (!isConnected || !address) {
        toast.error("Connect your EVM wallet to continue");
        return;
      }
    } else {
      if (!stellar.isConnected || !stellar.address) {
        toast.error("Connect your Stellar wallet to continue");
        return;
      }
    }

    // Free plans (price = 0) cannot be registered — PlanFactory requires price > 0
    if (parseFloat(plan.price) === 0) {
      toast.error("Free plans don't need on-chain registration.", {
        duration: 4000,
      });
      return;
    }

    setSyncingPlanId(plan.id);
    try {
      // 1. Fetch nonce and contract info
      const nonceRes = await fetch(`/api/catalog/plans/${plan.id}/sign-nonce`);
      if (!nonceRes.ok) {
        const nonceErr = await nonceRes.json().catch(() => ({}));
        throw new Error(nonceErr.error || "Failed to get signing nonce");
      }
      const noncePayload = (await nonceRes.json().catch(() => ({}))) as {
        nonce?: string;
        planFactoryAddress?: string;
        domain?: {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: string;
        };
        networkPassphrase?: string;
        sorobanRpcUrl?: string;
        signingRequired?: boolean;
        providerAddress?: string;
        signatureMode?: "create" | "update";
        needsTokenApproval?: boolean;
        tokenAddress?: string;
        error?: string;
      };

      if (!nonceRes.ok) {
        if (noncePayload.needsTokenApproval && noncePayload.tokenAddress) {
          toast.error(
            `The token ${noncePayload.tokenAddress} is not approved in the PlanFactory contract. ` +
            "You must call approve_token as the contract admin before registering plans. " +
            "Use the Stellar CLI or a script to invoke approve_token on the PlanFactory.",
            { duration: 10000 },
          );
          return;
        }
        throw new Error(noncePayload.error || "Failed to get signing nonce");
      }

      // ── Stellar Soroban path ─────────────────────────────────────────────
      if (!isEvmPlan) {
        const {
          planFactoryAddress,
          networkPassphrase,
          sorobanRpcUrl,
          providerAddress,
          signatureMode,
        } = noncePayload;

        if (!networkPassphrase || !sorobanRpcUrl) {
          throw new Error("Stellar network configuration missing from server");
        }

        const effectiveSignatureMode =
          signatureMode === "create" ? "create" : plan.onChainPlanId ? "update" : "create";
        const priceInMicros = resolveMaxOnChainChargeMicros(plan);
        const billingIntervalSeconds = BigInt(plan.billingInterval);

        if (!planFactoryAddress) {
          throw new Error("PlanFactory address missing from server");
        }
        const client = (await stellarContract.Client.from({
          contractId: planFactoryAddress,
          networkPassphrase,
          rpcUrl: sorobanRpcUrl,
          publicKey: stellar.address!,
          signTransaction: stellar.signTransaction,
        })) as any;

        let onChainPlanId: string;
        let sentTx;

        if (effectiveSignatureMode === "create") {
          const tx = await client.create_plan({
            provider: providerAddress ?? stellar.address!,
            name: plan.name,
            tier: plan.tier,
            price: priceInMicros,
            billing_interval: billingIntervalSeconds,
            accepted_token: plan.acceptedToken,
            metadata_uri: "",
          });
          sentTx = await tx.signAndSend();
          onChainPlanId = String(sentTx.result);
        } else {
          if (!plan.onChainPlanId) {
            throw new Error("Cannot update: no existing on-chain plan ID");
          }
          const tx = await client.update_plan({
            provider: providerAddress ?? stellar.address!,
            plan_id: BigInt(plan.onChainPlanId),
            price: priceInMicros,
            metadata_uri: "",
          });
          sentTx = await tx.signAndSend();
          onChainPlanId = plan.onChainPlanId;
        }

        const txHash = sentTx.sendTransactionResponse?.hash ?? "";

        // 2. Confirm with backend
        const confirmRes = await fetch(
          `/api/catalog/plans/${plan.id}/register-on-chain`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              onChainPlanId,
              txHash,
              userAddress: stellar.address,
            }),
          },
        );
        const confirmData = (await confirmRes.json().catch(() => ({}))) as {
          error?: string;
          onChainPlanId?: string;
          status?: string;
        };
        if (!confirmRes.ok) {
          throw new Error(confirmData.error || "Backend confirmation failed");
        }

        toast.success(
          `Plan registered on-chain (${onChainPlanId}) via Stellar`,
        );
        load();
        return;
      }

      // ── EVM path (unchanged) ─────────────────────────────────────────────
      if (!noncePayload.nonce || !noncePayload.domain) {
        throw new Error("Missing EVM nonce/domain from server");
      }
      const {
        nonce,
        planFactoryAddress,
        domain,
        signingRequired,
        providerAddress,
        signatureMode,
      } = noncePayload as typeof noncePayload & {
        nonce: string;
        domain: { name: string; version: string; chainId: number; verifyingContract: string };
      };
      const effectiveSignatureMode =
        signatureMode === "create" ? "create" : plan.onChainPlanId ? "update" : "create";
      const resolvedOnChainPlanId =
        effectiveSignatureMode === "update" ? plan.onChainPlanId : null;

      if (chainId !== domain.chainId) {
        const expectedLabel = getChainLabel(domain.chainId);
        toast.error(
          `Switch your wallet to ${expectedLabel} to sync this plan.`,
        );
        return;
      }

      if (signingRequired) {
        // Verify the connected wallet matches the stored provider wallet
        try {
          const walletRes = await fetch("/api/auth/wallet-status");
          if (walletRes.ok) {
            const { storedWallet } = await walletRes.json();
            if (
              storedWallet && address &&
              address.toLowerCase() !== storedWallet.toLowerCase()
            ) {
              toast.error(
                `Wrong wallet connected. Switch to ${storedWallet.slice(0, 6)}…${storedWallet.slice(-4)} to register on-chain.`,
                { duration: 6000 },
              );
              return;
            }
          }
        } catch {
          // Non-blocking — proceed if wallet-status check fails
        }
      }

      // 2. Prepare plan parameters for signing
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const priceInUsdc = resolveMaxOnChainChargeMicros(plan);
      // CatalogPlan.billingInterval is already stored in seconds. Do not
      // convert it a second time before encoding the contract uint32 field.
      const billingIntervalSeconds = plan.billingInterval;

      // 3. Sign EIP-712 typed data when the provider is the connected wallet
      const signature = signingRequired
        ? await signTypedDataAsync({
            domain: {
              name: domain.name,
              version: domain.version,
              chainId: BigInt(domain.chainId),
              verifyingContract: planFactoryAddress as `0x${string}`,
            },
            types: effectiveSignatureMode === "update"
              ? {
                  UpdatePlan: [
                    { name: "provider", type: "address" },
                    { name: "planId", type: "uint256" },
                    { name: "price", type: "uint256" },
                    { name: "metadataURI", type: "string" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                  ],
                }
              : {
                  CreatePlan: [
                    { name: "provider", type: "address" },
                    { name: "name", type: "string" },
                    { name: "tier", type: "string" },
                    { name: "price", type: "uint256" },
                    { name: "billingInterval", type: "uint32" },
                    { name: "acceptedToken", type: "address" },
                    { name: "metadataURI", type: "string" },
                    { name: "nonce", type: "uint256" },
                    { name: "deadline", type: "uint256" },
                  ],
                },
            primaryType:
              effectiveSignatureMode === "update" ? "UpdatePlan" : "CreatePlan",
            message: effectiveSignatureMode === "update" && resolvedOnChainPlanId
              ? {
                  provider: (providerAddress ?? address) as `0x${string}`,
                  planId: BigInt(resolvedOnChainPlanId),
                  price: priceInUsdc,
                  metadataURI: "",
                  nonce: BigInt(nonce),
                  deadline: BigInt(deadline),
                }
              : {
                  provider: (providerAddress ?? address) as `0x${string}`,
                  name: plan.name,
                  tier: plan.tier,
                  price: priceInUsdc,
                  billingInterval: billingIntervalSeconds,
                  acceptedToken: plan.acceptedToken as `0x${string}`,
                  metadataURI: "",
                  nonce: BigInt(nonce),
                  deadline: BigInt(deadline),
                },
          })
        : undefined;

      // 4. Submit to API with signature
      const res = await fetch(
        `/api/catalog/plans/${plan.id}/register-on-chain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(signature ? { signature } : {}),
            ...(signingRequired ? { deadline, userAddress: address } : {}),
          }),
        },
      );
      const data = (await res
        .json()
        .catch(() => ({}))) as RegisterOnChainResponse;
      if (!res.ok) {
        if (res.status === 409 && isOwnerActionRequired(data)) {
          toast.error(formatOwnerActionMessage(data));
          void copyOwnerActionPayload(data);
          if (
            data.ownerActionRequired?.target &&
            data.ownerActionRequired?.data
          ) {
            console.info("[catalog] owner action required", {
              target: data.ownerActionRequired.target,
              value: data.ownerActionRequired.value ?? "0",
              data: data.ownerActionRequired.data,
              functionSignature: data.ownerActionRequired.functionSignature,
              args: data.ownerActionRequired.args ?? [],
            });
          }
          return;
        }
        throw new Error(data.error || "Registration failed");
      }

      if (data.preparedTransaction) {
        if (!publicClient) {
          throw new Error(
            `Public client unavailable for ${getChainLabel(domain.chainId)}`,
          );
        }
        if (!walletClient || !walletClient.account) {
          throw new Error("Connected wallet client unavailable");
        }

        let txHash: `0x${string}`;
        let usedGasless = false;
        const walletOnlyExecution =
          data.preparedTransaction.executionMode === "wallet";

        if (walletOnlyExecution) {
          console.info(
            "[catalog] Using direct wallet execution for provider-only on-chain registration.",
            {
              chainId: domain.chainId,
              target: data.preparedTransaction.target,
            },
          );
          txHash = await walletClient.sendTransaction({
            account: walletClient.account,
            to: data.preparedTransaction.target as `0x${string}`,
            data: data.preparedTransaction.data as `0x${string}`,
            value: BigInt(data.preparedTransaction.value ?? "0"),
          });
        } else {
          const smartAccountConfig = await fetchSmartAccountConfig(domain.chainId);
          if (smartAccountConfig) {
            const providerLabel = formatSmartAccountProviderLabel(
              smartAccountConfig.provider,
            );
            try {
              const result = await sendSmartAccountTransaction({
                chainId: domain.chainId,
                walletClient,
                to: data.preparedTransaction.target as `0x${string}`,
                data: data.preparedTransaction.data as `0x${string}`,
                value: BigInt(data.preparedTransaction.value ?? "0"),
                bundlerUrl: smartAccountConfig.bundlerUrl,
                paymasterUrl: smartAccountConfig.paymasterUrl,
              });
              txHash = result.txHash;
              usedGasless = true;
            } catch (error) {
              const message =
                error instanceof Error
                  ? error.message
                  : "Gas sponsorship failed";
              console.warn(
                "[catalog] Sponsored smart-account registration failed.",
                {
                  chainId: domain.chainId,
                  provider: smartAccountConfig.provider ?? "unknown",
                  message,
                  infrastructureError: isSmartAccountInfrastructureError(error),
                },
              );
              throw new Error(
                `${providerLabel} sponsorship failed for this registration. ${message}`,
              );
            }
          } else {
            throw new Error(
              "Gas sponsorship is not configured for this chain. Pimlico must be configured before this registration can be sent.",
            );
          }
        }

        const receipt = await publicClient.waitForTransactionReceipt({
          hash: txHash,
          timeout: 45_000,
        });

        if (receipt.status === "reverted") {
          throw new Error("Transaction reverted on-chain");
        }

        const createdLogs = parseEventLogs({
          abi: PlanFactoryABI,
          logs: receipt.logs,
          eventName: "PlanCreated",
          strict: false,
        });

        const expectedOwner = (
          data.planOwner ??
          data.providerAddress ??
          address
        )?.toLowerCase();

        const latestCreatedLog = [...createdLogs].reverse().find((log) => {
          const provider = (log as { args?: { provider?: string } }).args
            ?.provider;
          return (
            typeof provider === "string" &&
            expectedOwner &&
            provider.toLowerCase() === expectedOwner
          );
        });

        let onChainPlanId = (
          latestCreatedLog as { args?: { planId?: bigint } } | undefined
        )?.args?.planId?.toString();

        if (!onChainPlanId && expectedOwner) {
          const providerPlans = (await publicClient.readContract({
            address: planFactoryAddress as `0x${string}`,
            abi: PlanFactoryABI,
            functionName: "getProviderPlans",
            args: [expectedOwner as `0x${string}`],
          })) as bigint[];
          const latestProviderPlan = providerPlans.at(-1);
          if (typeof latestProviderPlan === "bigint") {
            onChainPlanId = latestProviderPlan.toString();
          }
        }

        const confirmRes = await fetch(
          `/api/catalog/plans/${plan.id}/chain-confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              txHash,
              onChainPlanId,
              success: true,
            }),
          },
        );

        if (!confirmRes.ok) {
          const confirmErr = await confirmRes.json().catch(() => ({}));
          throw new Error(
            confirmErr.error || "Failed to confirm on-chain registration",
          );
        }

        toast.success(
          `${usedGasless ? "Registered gaslessly" : "Registered"} on-chain · ${txHash.slice(0, 10)}…`,
        );
        load();
        return;
      }

      toast.success(
        data.noOp
          ? "Plan is already in sync on-chain"
          : `${plan.onChainPlanId ? "Synced" : "Registered"} on-chain · ${(
              data.txHash ?? ""
            ).slice(0, 10)}…`,
      );
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      // Handle user rejection
      if (
        msg.includes("rejected") ||
        msg.includes("denied") ||
        msg.includes("User rejected")
      ) {
        toast.error("Signature or transaction cancelled");
      } else if (
        msg.includes("TokenNotApproved") ||
        msg.includes("Error(Contract, #12)") ||
        msg.includes("#12") ||
        (msg.includes("contract error") && msg.includes("12"))
      ) {
        toast.error(
          "The accepted token is not approved in the PlanFactory contract. " +
          "You must call approve_token as the contract admin before registering plans. " +
          "Use the Stellar CLI: soroban contract invoke --id <PLAN_FACTORY> --network testnet --source <ADMIN> -- approve_token --admin <ADMIN> --token <TOKEN>",
          { duration: 12000 },
        );
      } else {
        toast.error(msg);
      }
    } finally {
      setSyncingPlanId(null);
    }
  }

  async function deletePlan(plan: CatalogPlan) {
    if (plan.status === "PUBLISHED") {
      toast.error(
        "Published plans cannot be deleted. Archive the plan instead.",
      );
      return;
    }
    if (plan.onChainPlanId) {
      toast.error(
        "On-chain plans cannot be deleted. Archive the plan instead.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete plan "${plan.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeletingPlanId(plan.id);
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
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete plan");
    } finally {
      setDeletingPlanId(null);
    }
  }

  const environmentName = activeEnvironment?.name ?? "this environment";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Select
            value={statusFilter || "all"}
            onValueChange={(v) =>
              setStatusFilter(v === "all" ? "" : (v as CatalogStatus))
            }
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="ARCHIVED">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          className="gap-1 self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={9} />
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/15 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-base font-semibold text-foreground">
            No plans in {environmentName} yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and publish your first plan to start selling in this workspace.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Interval</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead>v</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => {
              const transitions = NEXT_STATUS[plan.status] ?? [];
              const isFree = parseFloat(plan.price) === 0;
              const needsChainSync =
                !isFree &&
                plan.status !== "ARCHIVED" &&
                plan.chainSyncStatus !== "SYNCED" &&
                plan.chainSyncStatus !== "NOT_APPLICABLE";
              return (
                <TableRow
                  key={plan.id}
                  className="group cursor-pointer hover:bg-secondary/20 transition-colors"
                  onClick={(e) => {
                    // Don't trigger if clicking on actions/buttons
                    if (
                      (e.target as HTMLElement).closest("button") ||
                      (e.target as HTMLElement).closest("[role='menuitem']")
                    )
                      return;
                    onSelect?.(plan);
                  }}
                >
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {plan.tier}
                  </TableCell>
                  <TableCell>
                    {isFree ? (
                      <span className="text-sm font-medium text-foreground">
                        Free
                      </span>
                    ) : (
                      <div>
                        <span className="text-sm">
                          ${parseFloat(plan.price).toFixed(2)} USDC
                        </span>
                        {plan.annualPrice &&
                          parseFloat(plan.annualPrice) > 0 && (
                            <span className="block text-[10px] text-muted-foreground">
                              ${parseFloat(plan.annualPrice).toFixed(2)}/yr
                              {parseFloat(plan.price) > 0 && (
                                <span className="ml-1 text-foreground">
                                  ·{" "}
                                  {Math.round(
                                    (1 -
                                      parseFloat(plan.annualPrice) /
                                        (parseFloat(plan.price) * 12)) *
                                      100,
                                  )}
                                  % off
                                </span>
                              )}
                            </span>
                          )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {BILLING_INTERVALS.find(
                      (i) => i.seconds === plan.billingInterval,
                    )?.label ?? "Custom interval"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {isFree ? (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <span className="text-[8px] font-bold text-muted-foreground">∞</span>
                        </div>
                        Free
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <Web3Icon token="USDC" size="sm" />
                        {tokenLabel(plan.acceptedToken)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell>
                    {isFree ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border border-border text-muted-foreground bg-secondary">
                        Off-chain
                      </span>
                    ) : plan.chainSyncStatus &&
                      plan.chainSyncStatus !== "NOT_APPLICABLE" ? (
                      <ChainSyncBadge status={plan.chainSyncStatus} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    v{plan.version}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={
                            updating === plan.id ||
                            syncingPlanId === plan.id ||
                            deletingPlanId === plan.id
                          }
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditTarget(plan)}>
                          Edit Plan
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setEntTarget(plan)}>
                          Add Entitlement
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {transitions.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => updateStatus(plan.id, s)}
                          >
                            {statusActionLabel(s)}
                          </DropdownMenuItem>
                        ))}
                        {isFree ? (
                          <DropdownMenuItem disabled className="opacity-50">
                            <span className="flex flex-col gap-0.5">
                              <span>Register On-Chain</span>
                              <span className="text-[10px] text-muted-foreground font-normal">
                                Free plans are managed off-chain
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ) : needsChainSync ? (
                          <DropdownMenuItem
                            onClick={() => registerOnChain(plan)}
                            disabled={syncingPlanId === plan.id}
                          >
                            {syncingPlanId === plan.id
                              ? plan.onChainPlanId
                                ? "Syncing…"
                                : "Registering…"
                              : plan.onChainPlanId
                                ? "Sync On-Chain"
                                : "Register On-Chain"}
                          </DropdownMenuItem>
                        ) : null}
                        {!plan.onChainPlanId && plan.status !== "PUBLISHED" && (
                          <DropdownMenuItem
                            onClick={() => deletePlan(plan)}
                            className="text-destructive focus:text-destructive"
                          >
                            Delete Plan
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {editTarget && (
        <EditPlanDialog
          key={editTarget.id}
          plan={editTarget}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditTarget(null);
          }}
          onSaved={() => {
            load();
            setEditTarget(null);
          }}
        />
      )}
      {entTarget && (
        <AddEntitlementDialog
          key={entTarget.id}
          plan={entTarget}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEntTarget(null);
          }}
          onAdded={() => {
            load();
            setEntTarget(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Add-Ons Table ─────────────────────────────────────────────────────────────

function AddOnsTable({
  env,
  refresh,
  onSelect,
}: {
  env: EnvMode;
  refresh: number;
  onSelect?: (addon: CatalogAddOn) => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const { address } = useAccount();

  // ── Entitlements types ────────────────────────────────────────────────────
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

  const [addOns, setAddOns] = useState<CatalogAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);

  // ── Entitlements state ────────────────────────────────────────────────────
  const [entAddon, setEntAddon] = useState<{ id: string; name: string } | null>(
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

  // Per-addon entitlements cache for the features column
  const [addonEntitlements, setAddonEntitlements] = useState<
    Record<string, Entitlement[]>
  >({});

  // Feature flag suggestions
  const [featureFlags, setFeatureFlags] = useState<FeatureFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);

  // Copy-from state
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copyingEntitlements, setCopyingEntitlements] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ environmentMode: env });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/catalog/add-ons?${params}`);
      if (res.ok) {
        const data = await res.json();
        setAddOns(data.addOns ?? []);
      } else {
        console.error("[AddOnsTable] Failed to load add-ons:", res.status);
        setAddOns([]);
      }
    } catch (err) {
      console.error("[AddOnsTable] Load error:", err);
      setAddOns([]);
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter, activeEnvironment?.id]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  const loadEntitlements = useCallback(async (addonId: string) => {
    setEntLoading(true);
    try {
      const res = await fetch(`/api/catalog/add-ons/${addonId}/entitlements`);
      if (res.ok) {
        const data = await res.json();
        const ents: Entitlement[] = data.entitlements ?? [];
        setEntitlements(ents);
        setAddonEntitlements((prev) => ({ ...prev, [addonId]: ents }));
      }
    } finally {
      setEntLoading(false);
    }
  }, []);

  // Load entitlements when an add-on is opened
  useEffect(() => {
    if (entAddon) loadEntitlements(entAddon.id);
  }, [entAddon, loadEntitlements]);

  // Batch-load entitlements for all add-ons (populates the Features column)
  const allAddonsKey = addOns.map((a) => a.id).join(",");
  useEffect(() => {
    if (addOns.length === 0) return;
    Promise.all(
      addOns.map((addon) =>
        fetch(`/api/catalog/add-ons/${addon.id}/entitlements`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => ({
            id: addon.id,
            ents: (data?.entitlements ?? []) as Entitlement[],
          }))
          .catch(() => ({ id: addon.id, ents: [] as Entitlement[] })),
      ),
    ).then((results) => {
      const map: Record<string, Entitlement[]> = {};
      results.forEach(({ id, ents }) => {
        if (ents.length > 0) map[id] = ents;
      });
      if (Object.keys(map).length > 0) {
        setAddonEntitlements((prev) => ({ ...prev, ...map }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allAddonsKey]);

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

  const openEntitlements = (addon: { id: string; name: string }) => {
    setEntAddon(addon);
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

  const deleteEntitlement = async (addonId: string, featureKey: string) => {
    setDeletingKey(featureKey);
    try {
      const res = await fetch(
        `/api/catalog/add-ons/${addonId}/entitlements?featureKey=${featureKey}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        toast.success("Entitlement removed");
        await loadEntitlements(addonId);
      } else {
        toast.error("Failed to remove entitlement");
      }
    } finally {
      setDeletingKey(null);
    }
  };

  const toggleEntitlement = async (
    addonId: string,
    featureKey: string,
    enabled: boolean,
  ) => {
    setEntitlements((prev) =>
      prev.map((e) => (e.featureKey === featureKey ? { ...e, enabled } : e)),
    );
    setTogglingKey(featureKey);
    try {
      await fetch(`/api/catalog/add-ons/${addonId}/entitlements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureKey, enabled }),
      });
      await loadEntitlements(addonId);
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
    if (!entAddon) return;
    setAddEntLoading(true);
    try {
      let val: boolean | number | null = null;
      if (addEntForm.type === "BOOLEAN") val = addEntForm.enabled;
      else if (addEntForm.type === "NUMERIC") val = Number(addEntForm.value);
      const res = await fetch(
        `/api/catalog/add-ons/${entAddon.id}/entitlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            featureName: addEntForm.featureName,
            featureKey: addEntForm.featureKey,
            type: addEntForm.type,
            value: val,
            enabled: addEntForm.enabled,
          }),
        },
      );
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
        await loadEntitlements(entAddon.id);
      } else {
        const data = await res.json().catch(() => ({}));
        setAddEntErrors({
          _global:
            (data as { error?: string }).error || "Failed to add entitlement",
        });
      }
    } finally {
      setAddEntLoading(false);
    }
  };

  const handleCopyFromAddon = async (sourceAddonId: string) => {
    if (!entAddon) return;
    setCopyingEntitlements(true);
    setCopyFromOpen(false);
    try {
      const res = await fetch(
        `/api/catalog/add-ons/${sourceAddonId}/entitlements`,
      );
      if (!res.ok) {
        toast.error("Could not load source add-on entitlements");
        return;
      }
      const data = await res.json();
      const sourceEnts: Entitlement[] = data.entitlements ?? [];
      if (sourceEnts.length === 0) {
        toast.info("Source add-on has no entitlements to copy");
        return;
      }
      await Promise.allSettled(
        sourceEnts.map((ent) =>
          fetch(`/api/catalog/add-ons/${entAddon.id}/entitlements`, {
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
      await loadEntitlements(entAddon.id);
    } catch {
      toast.error("Failed to copy entitlements");
    } finally {
      setCopyingEntitlements(false);
    }
  };

  async function updateStatus(id: string, status: CatalogStatus) {
    setUpdating(id);
    try {
      const res = await fetch("/api/catalog/add-ons", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) load();
    } finally {
      setUpdating(null);
    }
  }

  async function handleDelete(id: string) {
    setUpdating(id);
    try {
      const res = await fetch("/api/catalog/add-ons", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        toast.error(data.error ?? "Failed to delete add-on");
      } else {
        toast.success("Add-on deleted");
        load();
      }
    } catch {
      toast.error("Could not delete add-on");
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) =>
            setStatusFilter(v === "all" ? "" : (v as CatalogStatus))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          className="gap-1"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={9} />
      ) : addOns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg bg-secondary/20">
          <Package className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No add-ons yet
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            Add-ons let you offer additional features and services that
            customers can purchase independent of plans. Create your first
            add-on to get started.
          </p>
          <p className="text-xs text-muted-foreground/60">
            Examples: Extra storage, priority support, custom domains
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Billing</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>v</TableHead>
              <TableHead>Features</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {addOns.map((addon) => {
              const transitions = NEXT_STATUS[addon.status] ?? [];
              return (
                <TableRow
                  key={addon.id}
                  className="cursor-pointer hover:bg-secondary/20 transition-colors"
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest("button") ||
                      (e.target as HTMLElement).closest("[role='menuitem']")
                    )
                      return;
                    onSelect?.(addon);
                  }}
                >
                  <TableCell className="font-medium">{addon.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {addon.code}
                  </TableCell>
                  <TableCell className="text-xs">
                    {addon.billingType === "ONE_TIME"
                      ? "One-time"
                      : "Recurring"}
                  </TableCell>
                  <TableCell>{parseFloat(addon.price).toFixed(2)}</TableCell>
                  <TableCell className="text-xs">
                    {tokenLabel(addon.acceptedToken)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={addon.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    v{addon.version}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const ents = addonEntitlements[addon.id] ?? [];
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
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={updating === addon.id}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            openEntitlements({ id: addon.id, name: addon.name })
                          }
                          className="flex items-center gap-2 text-sm"
                        >
                          <List className="w-3.5 h-3.5" />
                          Manage Entitlements
                        </DropdownMenuItem>
                        {transitions.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            {transitions.map((s) => (
                              <DropdownMenuItem
                                key={s}
                                onClick={() => updateStatus(addon.id, s)}
                              >
                                {statusActionLabel(s)}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                        {addon.status !== "PUBLISHED" && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              disabled={updating === addon.id}
                              onClick={() => handleDelete(addon.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* ── Entitlements Sheet ─────────────────────────────── */}
      <Sheet
        open={!!entAddon}
        onOpenChange={(open) => {
          if (!open) setEntAddon(null);
        }}
      >
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <SheetTitle className="flex items-center gap-2">
              <List className="w-5 h-5 text-accent" />
              {entAddon?.name} — Entitlements
            </SheetTitle>
            <SheetDescription>
              Define which features are included in this add-on.
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
                    title="Copy entitlements from another add-on"
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
                  {addOns.filter((a) => a.id !== entAddon?.id).length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No other add-ons
                    </div>
                  ) : (
                    addOns
                      .filter((a) => a.id !== entAddon?.id)
                      .map((a) => (
                        <DropdownMenuItem
                          key={a.id}
                          onClick={() => handleCopyFromAddon(a.id)}
                          className="text-sm"
                        >
                          {a.name}
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
                          <Skeleton
                            key={i}
                            className="h-6 w-20 rounded-full"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex gap-1.5 flex-wrap">
                        {featureFlags.map((flag) => (
                          <button
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
                        type="button"
                        onClick={() =>
                          setAddEntForm((f) => ({ ...f, type: t, value: "" }))
                        }
                        className={`flex flex-col items-center gap-1 py-2 px-1 rounded-lg border text-xs font-medium transition-all ${
                          addEntForm.type === t
                            ? "bg-accent text-accent-foreground border-accent"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                        }`}
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
                      Active on the add-on immediately
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
              <SkeletonList items={3} />
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
                        : "Click Add to define features included in this add-on"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((ent) => (
                      <div
                        key={ent.featureKey}
                        className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/30 transition-colors"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                          {ent.type === "BOOLEAN" ? (
                            <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                          ) : ent.type === "NUMERIC" ? (
                            <Hash className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <Package className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
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
                        <Switch
                          checked={ent.enabled}
                          disabled={togglingKey === ent.featureKey}
                          onCheckedChange={(v) =>
                            entAddon &&
                            toggleEntitlement(entAddon.id, ent.featureKey, v)
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            entAddon &&
                            deleteEntitlement(entAddon.id, ent.featureKey)
                          }
                          disabled={deletingKey === ent.featureKey}
                          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors disabled:opacity-50"
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
              {entitlements.length !== 1 ? "s" : ""} on this add-on
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Credit Types Table ────────────────────────────────────────────────────────

function CreditTypesTable({
  env,
  refresh,
  onSelect,
}: {
  env: EnvMode;
  refresh?: number;
  onSelect?: (credit: CatalogCreditType) => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const [creditTypes, setCreditTypes] = useState<CatalogCreditType[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ environmentMode: env });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/catalog/credits?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCreditTypes(data.creditTypes ?? []);
      } else {
        console.error("[CreditTypesTable] Failed to load credits:", res.status);
        setCreditTypes([]);
      }
    } catch (err) {
      console.error("[CreditTypesTable] Load error:", err);
      setCreditTypes([]);
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter, activeEnvironment?.id]);

  useEffect(() => {
    load();
  }, [load, refresh]);

  async function updateStatus(id: string, status: CatalogStatus) {
    setUpdating(id);
    try {
      const res = await fetch("/api/catalog/credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      if (res.ok) load();
    } finally {
      setUpdating(null);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch("/api/catalog/credits", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }));
        toast.error(data.error ?? "Failed to delete credit type");
      } else {
        toast.success("Credit type deleted");
        load();
      }
    } catch {
      toast.error("Could not delete credit type");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select
          value={statusFilter || "all"}
          onValueChange={(v) =>
            setStatusFilter(v === "all" ? "" : (v as CatalogStatus))
          }
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="PUBLISHED">Published</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="ghost"
          onClick={load}
          disabled={loading}
          className="gap-1"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : creditTypes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg bg-secondary/20">
          <Coins className="w-12 h-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No credit types yet
          </h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            Credit types enable usage-based billing by defining consumable units
            that customers can purchase or receive through their plans. Perfect
            for metered features.
          </p>
          <p className="text-xs text-muted-foreground/60">
            Examples: API calls, compute hours, storage gigabytes
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Credit Type</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Units/Pack</TableHead>
              <TableHead>Price (USDC)</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditTypes.map((ct) => {
              const transitions = NEXT_STATUS[ct.status] ?? [];
              return (
                <TableRow
                  key={ct.id}
                  className="cursor-pointer hover:bg-secondary/20 transition-colors"
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest("button") ||
                      (e.target as HTMLElement).closest("[role='menuitem']")
                    )
                      return;
                    onSelect?.(ct);
                  }}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-linear-to-br from-amber-500/20 to-orange-400/10 border border-border flex items-center justify-center">
                        <Coins className="w-4 h-4 text-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{ct.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {ct.code}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{ct.unitName}</TableCell>
                  <TableCell className="text-sm">{ct.unitsPerPack}</TableCell>
                  <TableCell className="text-sm font-medium">
                    ${parseFloat(ct.price).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ct.status} />
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={updating === ct.id}
                        >
                          {updating === ct.id ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="w-4 h-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {onSelect && (
                          <DropdownMenuItem onClick={() => onSelect(ct)}>
                            <ChevronRight className="w-3.5 h-3.5 mr-2" />
                            View Details
                          </DropdownMenuItem>
                        )}
                        {transitions.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => updateStatus(ct.id, s)}
                          >
                            {statusActionLabel(s)}
                          </DropdownMenuItem>
                        ))}
                        {ct.status !== "PUBLISHED" && (
                          <DropdownMenuItem
                            className="text-destructive"
                            disabled={deleting === ct.id}
                            onClick={() => handleDelete(ct.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-2" />
                            {deleting === ct.id ? "Deleting..." : "Delete"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Configuration Tab ─────────────────────────────────────────────────────────

type CatalogConfigSettings = {
  initialPlan: string;
  fallbackPlan: string;
  livePlanIds: string[];
  liveAddOnIds: string[];
  liveCreditTypeIds: string[];
  // display
  freePlanPriceDisplay: boolean;
  hideCredits: boolean;
  showFeatureDescriptions: boolean;
  showHardLimits: boolean;
  // plan change
  upgradeImmediately: boolean;
  downgradeImmediately: boolean;
  preventDowngradeOverLimit: boolean;
  disallowSelfServiceDowngrade: boolean;
  // contract / on-chain (kept in type for API compat — not exposed yet in UI)
  showBillingPeriodToggle: boolean;
  yearlyDiscountDisplay: boolean;
};

const DEFAULT_CONFIG_SETTINGS: CatalogConfigSettings = {
  initialPlan: "none",
  fallbackPlan: "none",
  livePlanIds: [],
  liveAddOnIds: [],
  liveCreditTypeIds: [],
  freePlanPriceDisplay: true,
  hideCredits: false,
  showFeatureDescriptions: true,
  showHardLimits: true,
  upgradeImmediately: true,
  downgradeImmediately: false,
  preventDowngradeOverLimit: true,
  disallowSelfServiceDowngrade: false,
  showBillingPeriodToggle: false,
  yearlyDiscountDisplay: false,
};

type ConfigPlanOption = Pick<
  CatalogPlan,
  | "id"
  | "name"
  | "tier"
  | "price"
  | "annualPrice"
  | "billingInterval"
  | "acceptedToken"
  | "chainId"
> & {
  companyCount: number;
};

type ConfigAddOnOption = Pick<
  CatalogAddOn,
  | "id"
  | "name"
  | "code"
  | "description"
  | "billingType"
  | "saleMode"
  | "price"
  | "billingIntervalDays"
  | "acceptedToken"
> & {
  grantCount: number;
};

type ConfigCreditTypeOption = Pick<
  CatalogCreditType,
  | "id"
  | "name"
  | "code"
  | "unitName"
  | "unitsPerPack"
  | "price"
  | "acceptedToken"
> & {
  bundleCount: number;
};

function addUniqueId(ids: string[], nextId: string): string[] {
  return ids.includes(nextId) ? ids : [...ids, nextId];
}

function removeSelectedId(ids: string[], removedId: string): string[] {
  return ids.filter((id) => id !== removedId);
}

function addOnPriceLabel(addOn: ConfigAddOnOption): string {
  const price = parseFloat(addOn.price);
  if (!Number.isFinite(price)) return "Custom";
  if (addOn.billingType === "RECURRING") {
    const everyDays = addOn.billingIntervalDays ?? 30;
    return `$${price.toFixed(2)} every ${everyDays}d`;
  }
  return `$${price.toFixed(2)} one-time`;
}

function creditBundlePriceLabel(creditType: ConfigCreditTypeOption): string {
  const price = parseFloat(creditType.price);
  if (!Number.isFinite(price)) return "Custom";
  return `${creditType.unitsPerPack} ${creditType.unitName} for $${price.toFixed(2)}`;
}

function ConfigurationTab() {
  const { envMode, activeEnvironment } = useEnvironment();
  const environmentKey = activeEnvironment?.id ?? envMode;
  const chainId = useChainId();
  const { isConnected, address } = useAccount();
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CatalogConfigSettings>(
    DEFAULT_CONFIG_SETTINGS,
  );
  const [loadedSettings, setLoadedSettings] = useState<CatalogConfigSettings>(
    DEFAULT_CONFIG_SETTINGS,
  );
  const [catalogPlans, setCatalogPlans] = useState<ConfigPlanOption[]>([]);
  const [configAddOns, setConfigAddOns] = useState<ConfigAddOnOption[]>([]);
  const [configCredits, setConfigCredits] = useState<ConfigCreditTypeOption[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      setLoadingConfig(true);
      setConfigError(null);
      try {
        const response = await fetch("/api/catalog/config", {
          cache: "no-store",
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "Failed to load configuration",
          );
        }
        if (cancelled) return;
        const plans = Array.isArray(data.catalog?.plans)
          ? (data.catalog.plans as ConfigPlanOption[])
          : [];
        const addOns = Array.isArray(data.catalog?.addOns)
          ? (data.catalog.addOns as ConfigAddOnOption[])
          : [];
        const creditTypes = Array.isArray(data.catalog?.creditTypes)
          ? (data.catalog.creditTypes as ConfigCreditTypeOption[])
          : [];
        const config = (data.config ?? {}) as Partial<CatalogConfigSettings> & {
          fallbackPlan?: string | null;
          livePlanIds?: string[] | null;
          liveAddOnIds?: string[] | null;
          liveCreditTypeIds?: string[] | null;
        };
        const nextSettings: CatalogConfigSettings = {
          ...DEFAULT_CONFIG_SETTINGS,
          ...config,
          fallbackPlan: config.fallbackPlan || "none",
          livePlanIds:
            config.livePlanIds == null
              ? plans.map((plan) => plan.id)
              : config.livePlanIds.filter((id) =>
                  plans.some((plan) => plan.id === id),
                ),
          liveAddOnIds:
            config.liveAddOnIds == null
              ? addOns.map((addOn) => addOn.id)
              : config.liveAddOnIds.filter((id) =>
                  addOns.some((addOn) => addOn.id === id),
                ),
          liveCreditTypeIds:
            config.liveCreditTypeIds == null
              ? creditTypes
                  .filter((creditType) => creditType.bundleCount > 0)
                  .map((creditType) => creditType.id)
              : config.liveCreditTypeIds.filter((id) =>
                  creditTypes.some(
                    (creditType) =>
                      creditType.id === id && creditType.bundleCount > 0,
                  ),
                ),
        };
        setCatalogPlans(plans);
        setConfigAddOns(addOns);
        setConfigCredits(creditTypes);
        setLoadedSettings(nextSettings);
        setSettings(nextSettings);
      } catch (err: unknown) {
        if (!cancelled) {
          setCatalogPlans([]);
          setConfigAddOns([]);
          setConfigCredits([]);
          setConfigError(
            err instanceof Error ? err.message : "Failed to load configuration",
          );
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [envMode, environmentKey]);

  useEffect(() => {
    if (catalogPlans.length === 0) return;

    const resolvePlanId = (value: string) => {
      if (!value || value === "none") return value;
      const match = catalogPlans.find(
        (plan) =>
          plan.id === value || plan.tier === value || plan.name === value,
      );
      return match?.id ?? value;
    };

    setSettings((current) => {
      const nextInitial = resolvePlanId(current.initialPlan);
      const nextFallback = resolvePlanId(current.fallbackPlan);
      if (
        nextInitial === current.initialPlan &&
        nextFallback === current.fallbackPlan
      ) {
        return current;
      }
      return {
        ...current,
        initialPlan: nextInitial,
        fallbackPlan: nextFallback,
        livePlanIds: current.livePlanIds.filter((id) =>
          catalogPlans.some((plan) => plan.id === id),
        ),
      };
    });
  }, [catalogPlans]);

  async function handleSave() {
    setSavingConfig(true);
    setConfigError(null);
    try {
      const res = await fetch("/api/catalog/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          environmentMode: envMode,
          fallbackPlan:
            settings.fallbackPlan === "none" ? null : settings.fallbackPlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setLoadedSettings(settings);
      toast.success(`Configuration saved for ${activeEnvironment?.name ?? envLabel}`);
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Failed to save configuration",
      );
    } finally {
      setSavingConfig(false);
    }
  }

  const configuredChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const envLabel = envMode === "DEVELOPMENT" ? "Development" : "Production";
  const envTag = envMode === "DEVELOPMENT" ? "DEV" : "PROD";
  const selectedLivePlans = catalogPlans.filter((plan) =>
    settings.livePlanIds.includes(plan.id),
  );
  const availableLivePlans = catalogPlans.filter(
    (plan) => !settings.livePlanIds.includes(plan.id),
  );
  const selectedLiveAddOns = configAddOns.filter((addOn) =>
    settings.liveAddOnIds.includes(addOn.id),
  );
  const availableLiveAddOns = configAddOns.filter(
    (addOn) => !settings.liveAddOnIds.includes(addOn.id),
  );
  const liveCreditCandidates = configCredits.filter(
    (creditType) => creditType.bundleCount > 0,
  );
  const selectedLiveCredits = liveCreditCandidates.filter((creditType) =>
    settings.liveCreditTypeIds.includes(creditType.id),
  );
  const availableLiveCredits = liveCreditCandidates.filter(
    (creditType) => !settings.liveCreditTypeIds.includes(creditType.id),
  );
  const hasPublishedPlans = catalogPlans.length > 0;
  const hasPublishedAddOns = configAddOns.length > 0;
  const hasPublishedCreditBundles = liveCreditCandidates.length > 0;
  const walletOnConfiguredChain = chainId === configuredChainId;
  const walletOnSupportedChain = isSupportedDashboardChainId(chainId);
  const configuredChainLabel = getChainLabel(configuredChainId);

  return (
    <div className="max-w-5xl space-y-6">
      {/* Top status bar */}
      <div className="rounded-xl border border-border bg-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full shrink-0",
            envMode === "DEVELOPMENT" ? "bg-zinc-400" : "bg-emerald-500",
          )} />
          <div>
            <p className="text-sm font-bold text-foreground">
              {activeEnvironment?.name ?? envLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              {configuredChainLabel}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {envTag}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {isConnected ? (
            <>
              <div className={cn(
                "w-2 h-2 rounded-full",
                walletOnConfiguredChain ? "bg-green-500" : walletOnSupportedChain ? "bg-orange-500" : "bg-red-500",
              )} />
              <span>
                {walletOnConfiguredChain
                  ? "Wallet connected"
                  : walletOnSupportedChain
                    ? `Wallet on ${getChainLabel(chainId)}`
                    : "Unsupported chain"}
                {address && (
                  <span className="ml-1 font-mono">
                    {address.slice(0, 6)}…{address.slice(-4)}
                  </span>
                )}
              </span>
            </>
          ) : (
            "Wallet not connected"
          )}
        </div>
      </div>

      {configError && (
        <div className="rounded-lg border border-border bg-secondary p-3 text-sm text-destructive">
          {configError}
        </div>
      )}

      {/* ── 1. Default Plans ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4 text-accent" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Default Plans</h3>
            <p className="text-xs text-muted-foreground">
              Auto-assign plans to new or lapsed subscribers
            </p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          {!hasPublishedPlans ? (
            <EmptyState
              title="Publish a plan first"
              description="Default plan settings appear after this environment has at least one published plan."
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-2">
                <Label htmlFor="initial-plan" className="text-sm font-semibold text-foreground">
                  Initial Plan
                </Label>
                <Select
                  value={settings.initialPlan}
                  onValueChange={(v) =>
                    setSettings((current) => ({
                      ...current,
                      initialPlan: v,
                      livePlanIds:
                        v === "none" ? current.livePlanIds : addUniqueId(current.livePlanIds, v),
                    }))
                  }
                >
                  <SelectTrigger id="initial-plan" className="h-11 bg-background border-border">
                    <SelectValue placeholder="Select a plan…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {catalogPlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <div className="flex items-center gap-2">
                          <span>{p.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {parseFloat(p.price) === 0 ? "Free" : `$${parseFloat(p.price).toFixed(2)} USDC`}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assigned when a wallet first connects.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fallback-plan" className="text-sm font-semibold text-foreground">
                  Fallback Plan
                </Label>
                <Select
                  value={settings.fallbackPlan}
                  onValueChange={(v) =>
                    setSettings((current) => ({
                      ...current,
                      fallbackPlan: v,
                      livePlanIds:
                        v === "none" ? current.livePlanIds : addUniqueId(current.livePlanIds, v),
                    }))
                  }
                >
                  <SelectTrigger id="fallback-plan" className="h-11 bg-background border-border">
                    <SelectValue placeholder="No fallback" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {catalogPlans
                      .filter((p) => parseFloat(p.price) === 0)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} (Free)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Assigned if a subscription lapses or is cancelled.
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── 2. Live Plans ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chart-1/10 flex items-center justify-center shrink-0">
            <List className="w-4 h-4 text-chart-1" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-foreground">Live Plans</h3>
            <p className="text-xs text-muted-foreground">
              Exposed in checkout and the billing portal
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {selectedLivePlans.length} live
          </Badge>
        </div>
        <div className="p-5 space-y-4">
          {selectedLivePlans.length === 0 ? (
            <EmptyState
              title="No live plans"
              description="Choose published plans below to make them visible to customers."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedLivePlans.map((plan) => {
                const lockedByDefault =
                  plan.id === settings.initialPlan || plan.id === settings.fallbackPlan;
                return (
                  <div
                    key={plan.id}
                    className="rounded-xl border border-border bg-background p-4 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {plan.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {planPriceLabel(plan)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span>{plan.companyCount} compan{plan.companyCount === 1 ? "y" : "ies"}</span>
                        {lockedByDefault && (
                          <span className="rounded-full border border-border px-1.5 py-0.5 font-semibold uppercase tracking-wide text-foreground bg-secondary/50">
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      disabled={lockedByDefault}
                      onClick={() =>
                        setSettings((current) => ({
                          ...current,
                          livePlanIds: removeSelectedId(current.livePlanIds, plan.id),
                        }))
                      }
                      title={lockedByDefault ? "Locked by default plan" : "Remove from live"}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          {/* Available to add */}
          <div className="rounded-xl border border-border bg-secondary/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-foreground">Add plans</p>
                <p className="text-xs text-muted-foreground">
                  Eligible published plans on {getChainLabel(configuredChainId)}
                </p>
              </div>
              <Badge variant="outline">{availableLivePlans.length}</Badge>
            </div>
            {!hasPublishedPlans ? (
              <p className="text-xs text-muted-foreground">Publish a plan first.</p>
            ) : availableLivePlans.length === 0 ? (
              <p className="text-xs text-muted-foreground">All eligible published plans are live.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableLivePlans.map((plan) => (
                  <Button
                    key={plan.id}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        livePlanIds: addUniqueId(current.livePlanIds, plan.id),
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {plan.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 3. Live Add-Ons ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chart-2/10 flex items-center justify-center shrink-0">
            <Puzzle className="w-4 h-4 text-chart-2" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-foreground">Live Add-Ons</h3>
            <p className="text-xs text-muted-foreground">
              Extras customers can purchase alongside plans
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {selectedLiveAddOns.length} live
          </Badge>
        </div>
        <div className="p-5 space-y-4">
          {selectedLiveAddOns.length === 0 ? (
            <EmptyState
              title="No live add-ons"
              description="Choose published add-ons to make them discoverable."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedLiveAddOns.map((addOn) => (
                <div
                  key={addOn.id}
                  className="rounded-xl border border-border bg-background p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {addOn.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {addOnPriceLabel(addOn)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{addOn.code}</span>
                      <span className="capitalize">{addOn.saleMode.toLowerCase().replace(/_/g, " ")}</span>
                      <span>{addOn.grantCount} grant{addOn.grantCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        liveAddOnIds: removeSelectedId(current.liveAddOnIds, addOn.id),
                      }))
                    }
                    title="Remove from live"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border bg-secondary/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-foreground">Add add-ons</p>
                <p className="text-xs text-muted-foreground">
                  Published add-ons pinned to {getChainLabel(configuredChainId)}
                </p>
              </div>
              <Badge variant="outline">{availableLiveAddOns.length}</Badge>
            </div>
            {!hasPublishedAddOns ? (
              <p className="text-xs text-muted-foreground">Publish an add-on first.</p>
            ) : availableLiveAddOns.length === 0 ? (
              <p className="text-xs text-muted-foreground">All published add-ons are live.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableLiveAddOns.map((addOn) => (
                  <Button
                    key={addOn.id}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        liveAddOnIds: addUniqueId(current.liveAddOnIds, addOn.id),
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {addOn.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 4. Live Credit Bundles ── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chart-3/10 flex items-center justify-center shrink-0">
            <Coins className="w-4 h-4 text-chart-3" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold text-foreground">Live Credit Bundles</h3>
            <p className="text-xs text-muted-foreground">
              Usage-based credit packs visible in checkout
            </p>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {selectedLiveCredits.length} live
          </Badge>
        </div>
        <div className="p-5 space-y-4">
          {selectedLiveCredits.length === 0 ? (
            <EmptyState
              title="No live credit bundles"
              description="Choose credit types with bundles to make them available."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {selectedLiveCredits.map((creditType) => (
                <div
                  key={creditType.id}
                  className="rounded-xl border border-border bg-background p-4 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {creditType.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {creditBundlePriceLabel(creditType)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{creditType.bundleCount} bundle option{creditType.bundleCount === 1 ? "" : "s"}</span>
                      <span>{creditType.code}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        liveCreditTypeIds: removeSelectedId(
                          current.liveCreditTypeIds,
                          creditType.id,
                        ),
                      }))
                    }
                    title="Remove from live"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-border bg-secondary/5 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-foreground">Add credit bundles</p>
                <p className="text-xs text-muted-foreground">
                  Credit types with at least one bundle option
                </p>
              </div>
              <Badge variant="outline">{availableLiveCredits.length}</Badge>
            </div>
            {configCredits.length > 0 && !hasPublishedCreditBundles ? (
              <p className="text-xs text-muted-foreground">
                Publish a credit type and add bundle options first.
              </p>
            ) : !hasPublishedCreditBundles ? (
              <p className="text-xs text-muted-foreground">Publish a credit bundle first.</p>
            ) : availableLiveCredits.length === 0 ? (
              <p className="text-xs text-muted-foreground">All credit bundles are live.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {availableLiveCredits.map((creditType) => (
                  <Button
                    key={creditType.id}
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() =>
                      setSettings((current) => ({
                        ...current,
                        liveCreditTypeIds: addUniqueId(
                          current.liveCreditTypeIds,
                          creditType.id,
                        ),
                      }))
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {creditType.name}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 px-1 pb-4 pt-2 bg-gradient-to-t from-background to-transparent">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">
            {loadingConfig
              ? <Skeleton className="h-4 w-32" />
              : "Changes are saved per environment"}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettings(loadedSettings)}
              disabled={loadingConfig || savingConfig}
            >
              Reset
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={loadingConfig || savingConfig}
              className="gap-2 min-w-[120px]"
            >
              {savingConfig ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Standalone Section Pages ───────────────────────────────────────────────────

export function CatalogAddOnsSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  const [selectedAddOn, setSelectedAddOn] = useState<CatalogAddOn | null>(null);
  const { currentTier } = useTeamTier();

  function tr() {
    setRefresh((n) => n + 1);
  }

  if (selectedAddOn) {
    return (
      <AddOnDetailView
        addon={selectedAddOn}
        onBack={() => setSelectedAddOn(null)}
        onUpdated={() => {
          tr();
          setSelectedAddOn(null);
        }}
      />
    );
  }

  const canCreateAddOns = currentTier && currentTier.limits.maxAddOns > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-1">
            Add-Ons
          </h2>
          <p className="text-sm text-muted-foreground">
            Create additional features and services that customers can purchase
            alongside plans
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreateAddOns ? (
            <CreateAddOnDialog env={envMode} onCreated={tr} />
          ) : (
            <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg border border-border bg-muted/30">
              Upgrade to Growth or Enterprise to create add-ons
            </div>
          )}
        </div>
      </div>
      <AddOnsTable
        env={envMode}
        refresh={refresh}
        onSelect={setSelectedAddOn}
      />
    </div>
  );
}

export function CatalogCreditsSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  const [selectedCredit, setSelectedCredit] =
    useState<CatalogCreditType | null>(null);
  const { currentTier } = useTeamTier();

  function tr() {
    setRefresh((n) => n + 1);
  }

  if (selectedCredit) {
    return (
      <CreditDetailView
        credit={selectedCredit}
        onBack={() => setSelectedCredit(null)}
        onUpdated={() => {
          tr();
          setSelectedCredit(null);
        }}
      />
    );
  }

  const canCreateCredits = currentTier && currentTier.limits.maxCreditTypes > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-1">
            Credits
          </h2>
          <p className="text-sm text-muted-foreground">
            Define credit types for usage-based billing and consumption tracking
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreateCredits ? (
            <CreateCreditTypeDialog env={envMode} onCreated={tr} />
          ) : (
            <div className="text-xs text-muted-foreground px-3 py-2 rounded-lg border border-border bg-muted/30">
              Upgrade to Growth or Enterprise to create credits
            </div>
          )}
        </div>
      </div>
      <CreditTypesTable
        env={envMode}
        refresh={refresh}
        onSelect={setSelectedCredit}
      />
    </div>
  );
}

export function CatalogConfigSection() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-1">
            Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose which published plans, add-ons, and credit bundles go live in this environment
          </p>
        </div>
      </div>
      <ConfigurationTab />
    </div>
  );
}

// ─── Entitlement Types ─────────────────────────────────────────────────────────

interface Entitlement {
  featureName: string;
  featureKey: string;
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value?: boolean | number | null;
  valueUnit?: string | null;
  enabled: boolean;
  featureType?: "boolean" | "event" | "trait";
  icon?: string | null;
}

function entitlementUsageLabel(): string {
  return "per billing cycle";
}

function entitlementPlanPriceLabel(
  plan: Pick<CatalogPlan, "price" | "annualPrice">,
): string {
  const monthly = `$${parseFloat(String(plan.price)).toFixed(2)}/mo`;
  if (Number(plan.annualPrice ?? 0) > 0) {
    return `${monthly} · $${parseFloat(String(plan.annualPrice)).toFixed(2)}/yr`;
  }
  return monthly;
}

function getEntitlementAvatarType(
  entitlement: Pick<Entitlement, "type" | "featureType">,
): "boolean" | "event" | "trait" {
  if (entitlement.featureType === "trait") return "trait";
  if (entitlement.featureType === "event") return "event";
  return entitlement.type === "BOOLEAN" ? "boolean" : "event";
}

// ─── Add Entitlement Dialog ────────────────────────────────────────────────────

type CatalogFeatureDef = {
  id: string;
  name: string;
  featureKey: string;
  featureType: "boolean" | "event" | "trait";
  eventKey: string | null;
  description: string | null;
  icon?: string | null;
};

function AddEntitlementDialog({
  plan,
  onAdded,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  currentEntitlements,
}: {
  plan: CatalogPlan;
  onAdded: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  currentEntitlements?: Entitlement[];
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [catalogFeatures, setCatalogFeatures] = useState<CatalogFeatureDef[]>(
    [],
  );
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [selectedFeature, setSelectedFeature] =
    useState<CatalogFeatureDef | null>(null);
  const [form, setForm] = useState({
    featureName: "",
    featureKey: "",
    type: "BOOLEAN" as "BOOLEAN" | "NUMERIC" | "UNLIMITED",
    value: "",
    valueUnit: "",
    enabled: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load features from catalog when dialog opens
  const featRef = useRef(currentEntitlements);
  featRef.current = currentEntitlements;

  useEffect(() => {
    if (!open) return;
    setFeaturesLoading(true);
    fetch("/api/v1/features")
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d: { features?: CatalogFeatureDef[] }) => {
        const added = featRef.current ?? [];
        const addedKeys = new Set(added.map((e) => e.featureKey.toLowerCase()));
        // Filter out features already added to this plan
        setCatalogFeatures(
          (d.features ?? []).filter(
            (feat) => !addedKeys.has(feat.featureKey.toLowerCase()),
          ),
        );
      })
      .catch(() => setCatalogFeatures([]))
      .finally(() => setFeaturesLoading(false));
  }, [open]);

  function selectFeature(feat: CatalogFeatureDef) {
    setSelectedFeature(feat);
    // Boolean features → BOOLEAN entitlement; trait/event features → NUMERIC
    const isBool = feat.featureType === "boolean";
    const type: "BOOLEAN" | "NUMERIC" | "UNLIMITED" = isBool
      ? "BOOLEAN"
      : "NUMERIC";
    setForm({
      featureName: feat.name,
      featureKey: feat.featureKey,
      type,
      value: "",
      valueUnit: feat.eventKey ?? "",
      enabled: true,
    });
    setErrors({});
  }

  // ─── Helper to check if a feature is boolean ────────────────────────────
  const isBooleanFeature = selectedFeature?.featureType === "boolean";

  function clearFeature() {
    setSelectedFeature(null);
    setForm({
      featureName: "",
      featureKey: "",
      type: "BOOLEAN",
      value: "",
      valueUnit: "",
      enabled: true,
    });
    setErrors({});
  }

  async function handleSave() {
    const e: Record<string, string> = {};
    if (!form.featureKey.trim()) e.featureKey = "Feature is required";
    if (
      (currentEntitlements ?? []).some(
        (ent) =>
          ent.featureKey.toLowerCase() === form.featureKey.trim().toLowerCase(),
      )
    ) {
      e.featureKey = "This feature already exists on this plan";
    }
    if (form.type === "NUMERIC") {
      const n = Number(form.value);
      if (form.value === "" || isNaN(n) || n < 0)
        e.value = "Enter a valid limit";
    }
    if (Object.keys(e).length) {
      setErrors(e);
      return;
    }

    setLoading(true);
    try {
      let val: boolean | number | null = null;
      if (form.type === "BOOLEAN") val = form.enabled;
      else if (form.type === "NUMERIC") val = Number(form.value);
      const res = await fetch(`/api/catalog/plans/${plan.id}/entitlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureName: form.featureName || form.featureKey,
          featureKey: form.featureKey,
          type: form.type,
          value: val,
          enabled: form.enabled,
          valueUnit: form.valueUnit || null,
          featureType: selectedFeature?.featureType,
          icon: selectedFeature?.icon ?? null,
        }),
      });
      if (res.ok) {
        setOpen(false);
        clearFeature();
        onAdded();
        toast.success("Entitlement added");
      } else {
        const data = (await res.json()) as { error?: string };
        setErrors({ _global: data.error || "Failed to add entitlement" });
      }
    } finally {
      setLoading(false);
    }
  }

  const isFree = parseFloat(plan.price) === 0;
  const planPrice = isFree
    ? "Free"
    : entitlementPlanPriceLabel(plan);

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) clearFeature();
        setOpen(v);
      }}
    >
      {externalOpen === undefined && (
        <SheetTrigger asChild>
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            Add entitlement
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="w-full sm:max-w-lg flex flex-col p-0 gap-0">
        {/* Header */}
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Plan Entitlement
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <SheetTitle className="text-lg font-semibold">
              {plan.name}
            </SheetTitle>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="text-lg text-muted-foreground font-normal">
              {selectedFeature ? selectedFeature.name : "Choose feature"}
            </span>
          </div>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* ── Feature selector ── */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Feature</Label>
            {featuresLoading ? (
              <Skeleton className="h-11 w-full rounded-lg" />
            ) : (
              <Select
                value={selectedFeature?.id ?? ""}
                onValueChange={(id) => {
                  const feat = catalogFeatures.find((f) => f.id === id);
                  if (feat) selectFeature(feat);
                }}
              >
                <SelectTrigger className="h-11 bg-secondary border-border">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {catalogFeatures.length === 0 ? (
                    <div className="px-3 py-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No features yet
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Go to <strong>Manage → Features</strong> to create
                        features first
                      </p>
                    </div>
                  ) : (
                    catalogFeatures.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          <FeatureAvatar
                            featureType={f.featureType}
                            icon={f.icon ?? null}
                            className="w-5 h-5 rounded"
                          />
                          <span className="font-medium">{f.name}</span>
                          <code className="text-xs text-muted-foreground font-mono">
                            {f.featureKey}
                          </code>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
            {errors._global && (
              <p className="text-sm text-destructive">{errors._global}</p>
            )}
          </div>

          {/* ── Monetization Settings (shown once feature selected) ── */}
          {!selectedFeature ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-border bg-secondary/20">
              <ToggleLeft className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">
                Select a feature to configure entitlement
              </p>
            </div>
          ) : (
            <>
              {/* Feature info pill */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                <FeatureAvatar
                  featureType={selectedFeature.featureType}
                  icon={selectedFeature.icon ?? null}
                  className="w-8 h-8"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {selectedFeature.name}
                  </p>
                  <code className="text-xs text-muted-foreground font-mono">
                    {selectedFeature.featureKey}
                  </code>
                </div>
                <button
                  type="button"
                  onClick={clearFeature}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Entitlement type */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Entitlement type</Label>
                <div className="space-y-2">
                  {(["BOOLEAN", "NUMERIC", "UNLIMITED"] as const)
                    .filter((t) => {
                      // Lock type to feature's kind: boolean → only BOOLEAN, trait/event → NUMERIC/UNLIMITED
                      if (isBooleanFeature) return t === "BOOLEAN";
                      return t === "NUMERIC" || t === "UNLIMITED";
                    })
                    .map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() =>
                          setForm((f) => ({ ...f, type: t, value: "" }))
                        }
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-sm transition-all text-left ${
                          form.type === t
                            ? "bg-accent/5 border-accent text-foreground"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${form.type === t ? "bg-accent/10" : "bg-card border border-border"}`}
                        >
                          {t === "BOOLEAN" ? (
                            <ToggleLeft
                              className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`}
                            />
                          ) : t === "NUMERIC" ? (
                            <Hash
                              className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`}
                            />
                          ) : (
                            <Package
                              className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`}
                            />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium leading-none">
                            {t === "BOOLEAN"
                              ? "Boolean"
                              : t === "NUMERIC"
                                ? "Numeric limit"
                                : "Unlimited"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t === "BOOLEAN"
                              ? "On / Off access"
                              : t === "NUMERIC"
                                ? "Usage cap per billing period"
                                : "No cap enforced"}
                          </p>
                        </div>
                        {form.type === t && (
                          <Check className="w-4 h-4 text-accent shrink-0" />
                        )}
                      </button>
                    ))}
                </div>
              </div>

              {/* NUMERIC fields */}
              {form.type === "NUMERIC" && (
                <div className="space-y-3 p-4 rounded-lg bg-secondary/30 border border-border">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Limit *
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.value}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, value: e.target.value }))
                      }
                      placeholder="e.g. 300"
                      className="bg-background border-border"
                    />
                    {errors.value && (
                      <p className="text-xs text-destructive">{errors.value}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Unit label</Label>
                    <Input
                      value={form.valueUnit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, valueUnit: e.target.value }))
                      }
                      placeholder="e.g. Scans, API calls"
                      className="bg-background border-border"
                    />
                    {form.value && (
                      <p className="text-xs text-muted-foreground">
                        Displays as:{" "}
                        <strong>
                          {form.value} {form.valueUnit || "units"}{" "}
                          {entitlementUsageLabel()}
                        </strong>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* BOOLEAN toggle */}
              {form.type === "BOOLEAN" && (
                <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                  <div>
                    <p className="text-sm font-medium">Enabled by default</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Feature is on for all subscribers of this plan
                    </p>
                  </div>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) =>
                      setForm((f) => ({ ...f, enabled: v }))
                    }
                  />
                </div>
              )}

              {/* Plan preview */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Plan Preview
                </Label>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground">
                        {plan.name}
                      </p>
                      {plan.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {plan.description}
                        </p>
                      )}
                    </div>
                    <p className="text-base font-bold text-foreground whitespace-nowrap">
                      {isFree
                        ? "Free"
                        : planPrice}
                    </p>
                  </div>
                  <div className="space-y-1.5 pt-3 border-t border-border">
                    {(currentEntitlements ?? []).map((ent) => (
                      <div
                        key={ent.featureKey}
                        className="flex items-center gap-2"
                      >
                        <div className="w-5 h-5 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                          <FeatureAvatar
                            featureType={getEntitlementAvatarType(ent)}
                            icon={ent.icon ?? null}
                            className="w-4 h-4 rounded"
                          />
                        </div>
                        <p className="text-xs text-foreground">
                          {ent.featureName}
                        </p>
                        <p className="text-xs text-muted-foreground ml-auto">
                          {ent.type === "NUMERIC"
                            ? `${ent.value} ${ent.valueUnit ?? ""} ${entitlementUsageLabel()}`
                            : ent.enabled
                              ? "On"
                              : "Off"}
                        </p>
                      </div>
                    ))}
                    {/* New entitlement preview */}
                    <div className="flex items-center gap-2 pt-1 border-t border-dashed border-border/50">
                      <div className="w-5 h-5 rounded bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
                        <FeatureAvatar
                          featureType={selectedFeature.featureType}
                          icon={selectedFeature.icon ?? null}
                          className="w-4 h-4 rounded"
                        />
                      </div>
                      <p className="text-xs font-medium text-foreground">
                        {selectedFeature.name}
                      </p>
                      <p className="text-xs text-muted-foreground ml-auto">
                        {form.type === "NUMERIC" && form.value
                          ? `${form.value} ${form.valueUnit || ""} ${entitlementUsageLabel()}`
                          : form.type === "UNLIMITED"
                            ? "Unlimited"
                            : form.enabled
                              ? "On"
                              : "Off"}
                      </p>
                      <span className="text-xs text-accent font-semibold">
                        New
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-card shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!selectedFeature || loading} onClick={handleSave}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Edit Plan Dialog ──────────────────────────────────────────────────────────

function EditPlanDialog({
  plan,
  onSaved,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: {
  plan: CatalogPlan;
  onSaved: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { activeEnvironment } = useEnvironment();
  const chainId = useChainId();
  // The selected workspace environment is authoritative. Older draft rows may
  // still contain a stale default chain, so do not let that hide the Arc token.
  const tokenOptions = getTokenOptionsForChain(
    activeEnvironment?.chainId ??
      plan.chainId ??
      resolveEnvironmentChainId(plan.environmentMode),
  );

  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const isOnChainLocked = Boolean(plan.onChainPlanId);

  const initPlanType: "free" | "paid" =
    parseFloat(plan.price) === 0 ? "free" : "paid";
  const [planType, setPlanType] = useState<"free" | "paid">(initPlanType);
  const [billingIntervalDays, setBillingIntervalDays] = useState(
    plan.billingInterval,
  );
  const initialAnnualPrice =
    plan.annualPrice && parseFloat(plan.annualPrice) > 0
      ? parseFloat(plan.annualPrice).toFixed(2)
      : "";
  const [hasAnnualPrice, setHasAnnualPrice] = useState(
    Boolean(initialAnnualPrice) && plan.billingInterval !== YEARLY_INTERVAL,
  );
  const [annualDiscount, setAnnualDiscount] = useState(() => {
    const monthly = parseFloat(plan.price);
    const annual = plan.annualPrice ? parseFloat(plan.annualPrice) : 0;
    if (monthly > 0 && annual > 0) {
      const pct = Math.round((1 - annual / (monthly * 12)) * 100);
      return String(Math.min(60, Math.max(0, pct)));
    }
    return "20";
  });

  const [form, setForm] = useState({
    name: plan.name,
    tier: plan.tier,
    description: plan.description ?? "",
    price: parseFloat(plan.price).toFixed(2),
    annualPrice: initialAnnualPrice,
    acceptedToken: plan.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const autoTier = form.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const selectedChainOpt = tokenOptions.find(
    (o) => o.address === form.acceptedToken,
  );
  const selectedIntervalLabel =
    BILLING_INTERVALS.find(
      (i) => i.seconds === billingIntervalDays,
    )?.label.toLowerCase() ?? "custom";
  const chainName = (o: TokenOption) => o.chainLabel;
  const chainInitial = (o: TokenOption) => {
    const n = o.chainLabel;
    return n.startsWith("Base")
      ? "B"
      : n.startsWith("Sepolia")
        ? "S"
        : n.startsWith("Arc")
          ? "A"
          : (n[0]?.toUpperCase() ?? "?");
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Required";
    if (planType === "paid") {
      if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0)
        errs.price = "Must be positive";
      if (hasAnnualPrice) {
        if (
          !form.annualPrice ||
          isNaN(Number(form.annualPrice)) ||
          Number(form.annualPrice) <= 0
        ) {
          errs.annualPrice = "Must be positive";
        }
      }
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: plan.id,
          name: form.name,
          tier: form.tier.trim() || autoTier || plan.tier,
          description: form.description || undefined,
          price: planType === "free" ? 0 : Number(form.price),
          annualPrice:
            planType === "paid" && hasAnnualPrice && form.annualPrice
              ? Number(form.annualPrice)
              : null,
          billingInterval: billingIntervalDays,
          acceptedToken: form.acceptedToken,
          chainId: selectedChainOpt?.chainId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        toast.success(
          data.plan?.chainSyncStatus === "PENDING" && plan.onChainPlanId
            ? "Plan updated — sync the monthly price on-chain to finish."
            : "Plan updated",
        );
        onSaved();
      } else {
        setErrors({ _global: data.error || "Failed to update plan" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {externalOpen === undefined && (
        <SheetTrigger asChild>
          <Button variant="outline" className="gap-2">
            <Pencil className="w-4 h-4" />
            Edit plan
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="w-full sm:max-w-4xl p-0 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div />
          <button
            onClick={() => setOpen(false)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Plan Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">
                Edit Plan
              </p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0 flex items-center justify-center text-white font-bold text-sm">
                  {form.name.charAt(0).toUpperCase() || "?"}
                </div>
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || (
                    <span className="font-normal text-muted-foreground">
                      Untitled plan
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">
                Plan Preview
              </p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">
                    {form.name || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {form.description || form.name || "—"}
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {planType === "free"
                      ? "Free"
                      : form.price
                        ? `$${form.price} USDC`
                        : "—"}
                    {planType === "paid" && form.price && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        / {selectedIntervalLabel}
                      </span>
                    )}
                  </p>
                  {planType === "paid" &&
                    hasAnnualPrice &&
                    form.annualPrice && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        or ${form.annualPrice} USDC / year
                        {form.price &&
                          Number(form.annualPrice) <
                            Number(form.price) * 12 && (
                            <span className="text-foreground ml-1">
                              (save{" "}
                              {Math.round(
                                (1 -
                                  Number(form.annualPrice) /
                                    (Number(form.price) * 12)) *
                                  100,
                              )}
                              %)
                            </span>
                          )}
                      </p>
                    )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">
                    No entitlements yet
                  </p>
                </div>
                <div className="px-4 pb-4">
                  <button className="w-full py-2.5 rounded-lg bg-secondary border border-border text-sm font-medium text-muted-foreground cursor-default">
                    Subscribe
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: Settings ── */}
          <div className="flex-1 overflow-y-auto">
            <form id="edit-plan-form" onSubmit={handleSubmit}>
              <div className="p-6 space-y-8">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">
                      Plan Settings
                    </h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {plan.environmentMode === "DEVELOPMENT"
                        ? "Dev"
                        : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Update this plan's settings.
                  </p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-secondary border border-border">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {isOnChainLocked && (
                  <div className="rounded-lg border border-border bg-secondary p-4">
                    <p className="text-sm font-medium text-warning">
                      This plan is already on-chain.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Monthly price changes can be synced. Name, tier, billing
                      interval, and token stay locked on the existing on-chain
                      plan, so create a new plan if you need to change them.
                    </p>
                  </div>
                )}

                {/* Name + Tier */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Name *
                    </Label>
                    <Input
                      value={form.name}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, name: e.target.value }));
                        setErrors((p) => ({ ...p, name: "" }));
                      }}
                      placeholder="e.g. Pro, Starter, Enterprise"
                      className="h-11 bg-background border-border"
                      disabled={isOnChainLocked}
                    />
                    {errors.name && (
                      <p className="text-xs text-destructive mt-1">
                        {errors.name}
                      </p>
                    )}
                  </div>
                  <div className="w-28">
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Tier
                      <span className="text-muted-foreground font-normal ml-1">
                        (auto)
                      </span>
                    </Label>
                    <Input
                      value={form.tier || autoTier}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, tier: e.target.value }))
                      }
                      placeholder={autoTier || plan.tier}
                      className="h-11 bg-background border-border font-mono text-sm"
                      disabled={isOnChainLocked}
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">
                    Description
                  </Label>
                  <Input
                    value={form.description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, description: e.target.value }))
                    }
                    placeholder="Describe this plan"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Optional
                  </p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">
                      Pricing
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">
                    Update pricing and billing settings
                  </p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Type
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={isOnChainLocked}
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <span className="font-medium">
                              {planType === "free" ? "Free" : "Paid"}
                            </span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem
                            disabled={isOnChainLocked}
                            onClick={() => {
                              setPlanType("free");
                              setHasAnnualPrice(false);
                              setForm((f) => ({
                                ...f,
                                price: "0",
                                annualPrice: "",
                              }));
                            }}
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">Free</p>
                              <p className="text-xs text-muted-foreground">
                                No charge — $0.00 USDC
                              </p>
                            </div>
                            {planType === "free" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isOnChainLocked}
                            onClick={() => setPlanType("paid")}
                          >
                            <div className="flex-1">
                              <p className="text-sm font-medium">Paid</p>
                              <p className="text-xs text-muted-foreground">
                                Recurring USDC payment
                              </p>
                            </div>
                            {planType === "paid" && (
                              <Check className="w-4 h-4 ml-2 text-foreground" />
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Billing Integration
                      </Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={isOnChainLocked}
                            className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt
                                  ? chainName(selectedChainOpt)
                                  : "Select token"}
                              </span>
                              {selectedChainOpt && (
                                <span
                                  className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-secondary text-success" : "bg-secondary text-muted-foreground border border-border"}`}
                                >
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">
                                  Connected
                                </span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {tokenOptions.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Testnets
                                </p>
                              </div>
                              {tokenOptions.filter(
                                (o) => o.tag === "testnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={isOnChainLocked}
                                    onClick={() =>
                                      setForm((f) => ({
                                        ...f,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                      <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                    )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {tokenOptions.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1">
                                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Mainnets
                                </p>
                              </div>
                              {tokenOptions.filter(
                                (o) => o.tag === "mainnet",
                              ).map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem
                                    key={opt.chainId}
                                    disabled={isOnChainLocked}
                                    onClick={() =>
                                      setForm((f) => ({
                                        ...f,
                                        acceptedToken: opt.address,
                                      }))
                                    }
                                    className="flex items-center justify-between gap-3 py-2.5"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <Web3Icon
                                        chainId={opt.chainId}
                                        size="sm"
                                        className={!isConn ? "opacity-40" : ""}
                                      />
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">
                                            {chainName(opt)}
                                          </p>
                                          {isConn && (
                                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">
                                              Connected
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                          {opt.symbol} ·{" "}
                                          {opt.address.slice(0, 6)}…
                                          {opt.address.slice(-4)}
                                        </p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && (
                                      <Check className="w-3.5 h-3.5 text-foreground shrink-0" />
                                    )}
                                    {!isConn && (
                                      <span className="text-[9px] text-muted-foreground shrink-0">
                                        Switch wallet to sync
                                      </span>
                                    )}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">
                              This environment only supports its configured chain.
                            </p>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Paid-only: Price + Interval */}
                  {planType === "paid" && (
                    <>
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Price per billing period (USDC) *
                          </Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                              $
                            </span>
                            <Input
                              value={form.price}
                              onChange={(e) => {
                                const nextPrice = e.target.value;
                                setForm((f) => {
                                  if (
                                    !hasAnnualPrice ||
                                    !nextPrice ||
                                    isNaN(Number(nextPrice))
                                  ) {
                                    return { ...f, price: nextPrice };
                                  }
                                  const computed = (
                                    Number(nextPrice) *
                                    12 *
                                    (1 - Number(annualDiscount) / 100)
                                  ).toFixed(2);
                                  return {
                                    ...f,
                                    price: nextPrice,
                                    annualPrice: computed,
                                  };
                                });
                                setErrors((p) => ({
                                  ...p,
                                  price: "",
                                  annualPrice: "",
                                }));
                              }}
                              placeholder="29.00"
                              type="number"
                              min="0.01"
                              step="0.01"
                              className="h-11 bg-background border-border pl-6"
                            />
                          </div>
                          {errors.price && (
                            <p className="text-xs text-destructive mt-1">
                              {errors.price}
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">
                            Billing Interval
                          </Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                disabled={isOnChainLocked}
                                className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="font-medium">
                                  {BILLING_INTERVALS.find(
                                    (i) => i.seconds === billingIntervalDays,
                                  )?.label ?? "Custom interval"}
                                </span>
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                              {BILLING_INTERVALS.map((iv) => (
                                <DropdownMenuItem
                                  key={iv.seconds}
                                  disabled={isOnChainLocked}
                                  onClick={() =>
                                    {
                                      setBillingIntervalDays(iv.seconds);
                                      if (iv.seconds === YEARLY_INTERVAL) {
                                        setHasAnnualPrice(false);
                                        setForm((f) => ({ ...f, annualPrice: "" }));
                                      }
                                    }
                                  }
                                  className="flex items-center justify-between"
                                >
                                  <div>
                                    <p className="text-sm font-medium">
                                      {iv.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {iv.sublabel}
                                    </p>
                                  </div>
                                  {billingIntervalDays === iv.seconds && (
                                    <Check className="w-4 h-4 text-foreground ml-2" />
                                  )}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <div className="mt-4 rounded-lg border border-border bg-secondary/20 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Annual Pricing
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Optional yearly price for checkout. This stays
                              off-chain; only the monthly price syncs on-chain.
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={hasAnnualPrice}
                            aria-disabled={
                              billingIntervalDays === YEARLY_INTERVAL ||
                              isOnChainLocked
                            }
                            disabled={
                              billingIntervalDays === YEARLY_INTERVAL ||
                              isOnChainLocked
                            }
                            onClick={() => {
                              const next = !hasAnnualPrice;
                              setHasAnnualPrice(next);
                              if (!next) {
                                setForm((f) => ({ ...f, annualPrice: "" }));
                              } else if (form.price) {
                                const computed = (
                                  Number(form.price) *
                                  12 *
                                  0.8
                                ).toFixed(2);
                                setForm((f) => ({
                                  ...f,
                                  annualPrice: computed,
                                }));
                                setAnnualDiscount("20");
                              }
                            }}
                            className={cn(
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                              (billingIntervalDays === YEARLY_INTERVAL ||
                                isOnChainLocked) &&
                                "cursor-not-allowed opacity-50",
                              hasAnnualPrice ? "bg-primary" : "bg-secondary",
                            )}
                          >
                            <span
                              className={cn(
                                "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                                hasAnnualPrice
                                  ? "translate-x-5"
                                  : "translate-x-0",
                              )}
                            />
                          </button>
                        </div>
                        {hasAnnualPrice && (
                          <div className="mt-4 space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">
                                  Discount off monthly × 12
                                </Label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min="0"
                                    max="60"
                                    step="1"
                                    value={annualDiscount}
                                    onChange={(e) => {
                                      const pct = e.target.value;
                                      setAnnualDiscount(pct);
                                      if (form.price) {
                                        const computed = (
                                          Number(form.price) *
                                          12 *
                                          (1 - Number(pct) / 100)
                                        ).toFixed(2);
                                        setForm((f) => ({
                                          ...f,
                                          annualPrice: computed,
                                        }));
                                        setErrors((p) => ({
                                          ...p,
                                          annualPrice: "",
                                        }));
                                      }
                                    }}
                                    className="flex-1 h-1.5 accent-primary cursor-pointer"
                                  />
                                  <div className="flex items-center gap-0.5 w-16 h-9 rounded-md border border-border bg-background px-2">
                                    <input
                                      type="number"
                                      min="0"
                                      max="60"
                                      value={annualDiscount}
                                      onChange={(e) => {
                                        const pct = Math.min(
                                          60,
                                          Math.max(
                                            0,
                                            Number(e.target.value) || 0,
                                          ),
                                        ).toString();
                                        setAnnualDiscount(pct);
                                        if (form.price) {
                                          const computed = (
                                            Number(form.price) *
                                            12 *
                                            (1 - Number(pct) / 100)
                                          ).toFixed(2);
                                          setForm((f) => ({
                                            ...f,
                                            annualPrice: computed,
                                          }));
                                          setErrors((p) => ({
                                            ...p,
                                            annualPrice: "",
                                          }));
                                        }
                                      }}
                                      className="w-full text-sm text-foreground bg-transparent outline-none"
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      %
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">
                                  Annual price (USDC)
                                </Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                                    $
                                  </span>
                                  <Input
                                    value={form.annualPrice}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setForm((f) => ({
                                        ...f,
                                        annualPrice: val,
                                      }));
                                      setErrors((p) => ({
                                        ...p,
                                        annualPrice: "",
                                      }));
                                      if (
                                        form.price &&
                                        val &&
                                        Number(val) > 0
                                      ) {
                                        const backPct = Math.round(
                                          (1 -
                                            Number(val) /
                                              (Number(form.price) * 12)) *
                                            100,
                                        );
                                        if (backPct >= 0 && backPct <= 60)
                                          setAnnualDiscount(String(backPct));
                                      }
                                    }}
                                    placeholder={
                                      form.price
                                        ? (
                                            Number(form.price) *
                                            12 *
                                            0.8
                                          ).toFixed(2)
                                        : "278.40"
                                    }
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    className="h-9 bg-background border-border pl-6 text-sm"
                                  />
                                </div>
                                {errors.annualPrice && (
                                  <p className="text-xs text-destructive mt-1">
                                    {errors.annualPrice}
                                  </p>
                                )}
                              </div>

                              {form.price &&
                                form.annualPrice &&
                                Number(form.annualPrice) > 0 && (
                                  <div className="pt-6 text-right">
                                    <p className="text-xs font-semibold text-foreground">
                                      {Math.round(
                                        (1 -
                                          Number(form.annualPrice) /
                                            (Number(form.price) * 12)) *
                                          100,
                                      )}
                                      % off
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      vs ${(Number(form.price) * 12).toFixed(2)}
                                      /yr
                                    </p>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            form="edit-plan-form"
            type="submit"
            disabled={loading}
            className="min-w-[140px]"
          >
            {loading ? (
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
  );
}

// ─── Plan Detail View ──────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function planPriceLabel(
  plan: Pick<CatalogPlan, "price" | "billingInterval">,
): string {
  const price = parseFloat(plan.price);
  if (price === 0) return "Free";
  const intervalLabel =
    billingIntervalLabel(plan.billingInterval) === "Monthly"
      ? "mo"
      : billingIntervalLabel(plan.billingInterval) === "Quarterly"
        ? "qtr"
        : "yr";
  return `$${price.toFixed(2)}/${intervalLabel}`;
}

function AddCreditGrantDialog({
  plan,
  onAdded,
  existingIds,
}: {
  plan: CatalogPlan;
  onAdded: () => void;
  existingIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creditTypes, setCreditTypes] = useState<CatalogCreditType[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [amount, setAmount] = useState("50");
  const [resetPeriod, setResetPeriod] = useState("plan_period");
  const [autoTopUp, setAutoTopUp] = useState(false);
  const { envMode } = useEnvironment();

  useEffect(() => {
    if (!open) return;
    setCreditsLoading(true);
    // Load all credits (published + draft) so users can always link them
    fetch(`/api/catalog/credits?environmentMode=${envMode}`)
      .then((r) => (r.ok ? r.json() : { creditTypes: [] }))
      .then((d: { creditTypes?: CatalogCreditType[] }) =>
        setCreditTypes(d.creditTypes ?? []),
      )
      .catch(() => setCreditTypes([]))
      .finally(() => setCreditsLoading(false));
  }, [open, envMode]);

  const availableTypes = creditTypes.filter(
    (ct) => !existingIds.includes(ct.id),
  );
  const selectedCredit = creditTypes.find((ct) => ct.id === selectedId);

  async function handleSubmit() {
    if (!selectedId || !amount) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${plan.id}/credit-grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creditTypeId: selectedId,
          amount: parseFloat(amount),
          resetPeriod,
          autoTopUp,
        }),
      });
      if (res.ok) {
        onAdded();
        setOpen(false);
        setSelectedId("");
        setAmount("50");
        toast.success("Credit grant added");
      } else {
        const d = (await res.json()) as { error?: string };
        toast.error(d.error || "Failed to add credit grant");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setSelectedId("");
          setAmount("50");
        }
        setOpen(v);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-medium">
          <Plus className="w-3.5 h-3.5" />
          Add credit grant
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Credit Grant
          </p>
          <SheetTitle className="text-lg font-semibold mt-0.5">
            Create Credit Grant for {plan.name}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Select a credit type and amount to grant to companies with this plan
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Plan (read-only) */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Plan</Label>
            <div className="h-10 px-3 flex items-center rounded-lg bg-secondary border border-border">
              <span className="text-sm text-foreground">{plan.name}</span>
            </div>
          </div>

          {/* Credit Type */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Credit Type</Label>
            {creditsLoading ? (
              <Skeleton className="h-10 w-full rounded-lg" />
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="bg-secondary border-border h-10">
                  <SelectValue placeholder="Select a credit type" />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.length === 0 ? (
                    <div className="px-3 py-5 text-center">
                      <p className="text-sm text-muted-foreground">
                        No credit types available
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Go to <strong>Catalog → Credits</strong> to create
                        credit types first
                      </p>
                    </div>
                  ) : (
                    availableTypes.map((ct) => (
                      <SelectItem key={ct.id} value={ct.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          <div className="w-5 h-5 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                            <Coins className="w-3 h-3 text-foreground" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{ct.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {ct.code}
                            </p>
                          </div>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Amount */}
          {selectedId && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Amount</Label>
              <div className="relative">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-secondary border-border pr-40"
                  placeholder="50"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  credits included in plan
                </span>
              </div>
              {selectedCredit && (
                <p className="text-xs text-muted-foreground">
                  {amount || "0"}{" "}
                  {selectedCredit.unitName || selectedCredit.name} will be
                  granted per reset period
                </p>
              )}
            </div>
          )}

          {/* Reset period */}
          {selectedId && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1">
                Reset <span className="text-destructive">*</span>
              </Label>
              <Select value={resetPeriod} onValueChange={setResetPeriod}>
                <SelectTrigger className="bg-secondary border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="plan_period">Plan period</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                  <SelectItem value="never">Never (one-time)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Auto Top-up */}
          {selectedId && (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-secondary/20">
              <input
                type="checkbox"
                id="autoTopUp"
                checked={autoTopUp}
                onChange={(e) => setAutoTopUp(e.target.checked)}
                className="mt-0.5 rounded border-border"
              />
              <div>
                <label
                  htmlFor="autoTopUp"
                  className="text-sm font-medium text-foreground cursor-pointer"
                >
                  Enable Auto Top-up
                </label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Automatically replenish credits when the balance runs low
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border bg-card shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!selectedId || !amount || loading}
            onClick={handleSubmit}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              "Create plan grant"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PlanDetailView({
  plan,
  onBack,
  onUpdated,
}: {
  plan: CatalogPlan;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const router = useRouter();
  const [detailTab, setDetailTab] = useState<
    "entitlements" | "companies" | "billing"
  >("entitlements");
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [entLoading, setEntLoading] = useState(false);
  const [entRefresh, setEntRefresh] = useState(0);
  const [entSearch, setEntSearch] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [creditGrants, setCreditGrants] = useState<any[]>([]);
  const [cgLoading, setCgLoading] = useState(false);
  const [cgRefresh, setCgRefresh] = useState(0);
  const [subscribedCompanies, setSubscribedCompanies] = useState<PlanCompany[]>(
    [],
  );
  const [companiesLoading, setCompaniesLoading] = useState(false);

  const loadEntitlements = useCallback(async () => {
    setEntLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${plan.id}/entitlements`);
      if (res.ok) {
        const data = (await res.json()) as { entitlements?: Entitlement[] };
        setEntitlements(data.entitlements ?? []);
      }
    } finally {
      setEntLoading(false);
    }
  }, [plan.id]);

  const loadCreditGrants = useCallback(async () => {
    setCgLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${plan.id}/credit-grants`);
      if (res.ok) {
        const data = await res.json();
        setCreditGrants(data.creditGrants ?? []);
      }
    } finally {
      setCgLoading(false);
    }
  }, [plan.id]);

  const loadCompanies = useCallback(async () => {
    setCompaniesLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${plan.id}/companies`, {
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: PlanCompany[] };
        setSubscribedCompanies(data.data ?? []);
      }
    } finally {
      setCompaniesLoading(false);
    }
  }, [plan.id]);

  useEffect(() => {
    loadEntitlements();
    loadCreditGrants();
  }, [loadEntitlements, loadCreditGrants, entRefresh, cgRefresh]);

  useEffect(() => {
    if (detailTab === "companies") {
      loadCompanies();
    }
  }, [detailTab, loadCompanies]);

  async function deleteEntitlement(featureKey: string) {
    setDeletingKey(featureKey);
    try {
      const res = await fetch(
        `/api/catalog/plans/${plan.id}/entitlements?featureKey=${featureKey}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setEntRefresh((n) => n + 1);
        toast.success("Entitlement removed");
      } else {
        toast.error("Failed to remove entitlement");
      }
    } finally {
      setDeletingKey(null);
    }
  }

  async function toggleEntitlement(featureKey: string, enabled: boolean) {
    setToggling(featureKey);
    try {
      await fetch(`/api/catalog/plans/${plan.id}/entitlements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureKey, enabled }),
      });
      setEntRefresh((n) => n + 1);
    } finally {
      setToggling(null);
    }
  }

  async function deleteCreditGrant(creditTypeId: string) {
    if (!window.confirm("Remove this credit grant?")) return;
    try {
      const res = await fetch(
        `/api/catalog/plans/${plan.id}/credit-grants?creditTypeId=${creditTypeId}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        setCgRefresh((n) => n + 1);
        toast.success("Credit grant removed");
      }
    } catch {
      toast.error("Failed to remove credit grant");
    }
  }

  function copyId() {
    navigator.clipboard.writeText(plan.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  function openEntitlementInFlags(featureKey: string) {
    router.push(
      `/?section=feature-flags&flag=${encodeURIComponent(featureKey)}&planId=${encodeURIComponent(plan.id)}&editPlan=1`,
      { scroll: false },
    );
  }

  const isFree = parseFloat(plan.price) === 0;
  const filteredEnt = entitlements.filter(
    (e) =>
      e.featureName.toLowerCase().includes(entSearch.toLowerCase()) ||
      e.featureKey.toLowerCase().includes(entSearch.toLowerCase()),
  );

  const DETAIL_TABS = ["entitlements", "companies", "billing"] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          PLANS
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium uppercase">
          {plan.name}
        </span>
      </div>

      {/* Plan header card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground leading-tight">
                {plan.name}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last modified {timeAgo(plan.updatedAt)}
              </p>
            </div>
          </div>

          {/* Right: badges + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Type badge */}
            <Badge variant="outline" className="text-xs gap-1">
              <Package className="w-3 h-3" />
              Plan
            </Badge>
            {/* Price badge */}
            <Badge
              variant="secondary"
              className={`text-xs font-semibold ${isFree ? "text-foreground" : ""}`}
            >
              {isFree ? "Free" : planPriceLabel(plan)}
            </Badge>
            {/* Annual price badge */}
            {!isFree &&
              plan.annualPrice &&
              parseFloat(plan.annualPrice) > 0 && (
                <Badge
                  variant="outline"
                  className="text-xs font-semibold text-foreground border-border bg-secondary"
                >
                  ${parseFloat(plan.annualPrice).toFixed(2)}/yr
                  {parseFloat(plan.price) > 0 && (
                    <span className="ml-1 opacity-70">
                      ·{" "}
                      {Math.round(
                        (1 -
                          parseFloat(plan.annualPrice) /
                            (parseFloat(plan.price) * 12)) *
                          100,
                      )}
                      % off
                    </span>
                  )}
                </Badge>
              )}
            {/* Chain sync badge */}
            {plan.chainSyncStatus && (
              <ChainSyncBadge status={plan.chainSyncStatus} />
            )}
            {/* Divider */}
            <div className="h-6 w-px bg-border hidden sm:block" />
            {/* Actions */}
            <div className="flex items-center gap-2">
              <EditPlanDialog plan={plan} onSaved={onUpdated} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyId}>
                    {copiedId ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-2 text-foreground" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        Copy Plan ID
                      </>
                    )}
                  </DropdownMenuItem>
                  {plan.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/plans", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: plan.id,
                            status: "PUBLISHED",
                          }),
                        });
                        onUpdated();
                        toast.success("Plan published");
                      }}
                    >
                      Publish Plan
                    </DropdownMenuItem>
                  )}
                  {plan.status !== "ARCHIVED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/plans", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: plan.id,
                            status: "ARCHIVED",
                          }),
                        });
                        onUpdated();
                        toast.success("Plan archived");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Archive Plan
                    </DropdownMenuItem>
                  )}
                  {!plan.onChainPlanId && plan.status !== "PUBLISHED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        const confirmed = window.confirm(
                          `Delete plan "${plan.name}"? This cannot be undone.`,
                        );
                        if (!confirmed) return;
                        const res = await fetch("/api/catalog/plans", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: plan.id }),
                        });
                        const data = await res
                          .json()
                          .catch(() => ({}) as { error?: string });
                        if (!res.ok) {
                          toast.error(data.error || "Failed to delete plan");
                          return;
                        }
                        onBack();
                        onUpdated();
                        toast.success("Plan deleted");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Delete Plan
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Description line below header */}
      {plan.description && (
        <p className="text-sm text-muted-foreground -mt-2">
          {plan.description}
        </p>
      )}

      {/* Detail tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-all -mb-px ${
                detailTab === tab
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
              {tab === "entitlements" && entitlements.length > 0 && (
                <span className="ml-2 text-xs bg-secondary rounded-full px-1.5 py-0.5">
                  {entitlements.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {detailTab === "entitlements" && (
        <div className="space-y-6">
          {/* ── Entitlements section ── */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <h3 className="text-base font-semibold">
                  {entitlements.length} Entitlement
                  {entitlements.length !== 1 ? "s" : ""}
                </h3>
                <p className="text-xs text-muted-foreground">
                  These entitlements apply to this plan, and event limits reset
                  on each subscriber&apos;s own billing cycle.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Find entitlement"
                    value={entSearch}
                    onChange={(e) => setEntSearch(e.target.value)}
                    className="h-9 w-48 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                  <svg
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
              </div>
            </div>

            {entLoading ? (
              <SkeletonTable rows={4} cols={4} />
            ) : (
              <>
                {filteredEnt.length > 0 ? (
                  <div className="bg-card border border-border rounded-xl overflow-hidden">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-border bg-secondary/50">
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Feature
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Entitlement Value
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Type
                          </th>
                          <th className="w-12" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEnt.map((ent) => (
                          <tr
                            key={ent.featureKey}
                            className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
                          >
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center">
                                  <FeatureAvatar
                                    featureType={getEntitlementAvatarType(ent)}
                                    icon={ent.icon ?? null}
                                    className="w-4 h-4 rounded"
                                  />
                                </div>
                                <div>
                                  <p className="text-sm font-medium">
                                    {ent.featureName}
                                  </p>
                                  <code className="text-xs text-muted-foreground font-mono">
                                    {ent.featureKey}
                                  </code>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {ent.type === "NUMERIC" ? (
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {ent.value ?? "—"}{" "}
                                    {ent.valueUnit
                                      ? `${ent.valueUnit} ${entitlementUsageLabel()}`
                                      : entitlementUsageLabel()}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Numerical limit
                                  </p>
                                </div>
                              ) : ent.type === "UNLIMITED" ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-green-500" />
                                  <span className="text-sm text-foreground">
                                    Unlimited
                                  </span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    !toggling &&
                                    toggleEntitlement(
                                      ent.featureKey,
                                      !ent.enabled,
                                    )
                                  }
                                  disabled={toggling === ent.featureKey}
                                  className="flex items-center gap-2 group"
                                >
                                  <div
                                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${ent.enabled ? "bg-green-500" : "bg-input"} ${toggling === ent.featureKey ? "opacity-60" : ""}`}
                                  >
                                    <span
                                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${ent.enabled ? "translate-x-4" : "translate-x-0"}`}
                                    />
                                  </div>
                                  <span
                                    className={`text-sm font-medium ${ent.enabled ? "text-foreground" : "text-muted-foreground"}`}
                                  >
                                    {ent.enabled ? "On" : "Off"}
                                  </span>
                                </button>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant="secondary" className="text-xs">
                                {ent.type === "BOOLEAN"
                                  ? "Boolean"
                                  : ent.type === "NUMERIC"
                                    ? "Event-based"
                                    : "Unlimited"}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() =>
                                      openEntitlementInFlags(ent.featureKey)
                                    }
                                  >
                                    Edit in Flags
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      toggleEntitlement(
                                        ent.featureKey,
                                        !ent.enabled,
                                      )
                                    }
                                    disabled={toggling === ent.featureKey}
                                  >
                                    {ent.enabled ? "Disable" : "Enable"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      deleteEntitlement(ent.featureKey)
                                    }
                                    disabled={deletingKey === ent.featureKey}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    {deletingKey === ent.featureKey ? (
                                      <>
                                        <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                                        Removing...
                                      </>
                                    ) : (
                                      "Remove"
                                    )}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  entSearch === "" && (
                    <div className="border border-dashed border-border rounded-xl py-10 flex flex-col items-center justify-center gap-2">
                      <Hash className="w-8 h-8 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        No entitlements yet
                      </p>
                    </div>
                  )
                )}

                <div className="flex items-center gap-3">
                  <AddEntitlementDialog
                    plan={plan}
                    currentEntitlements={entitlements}
                    onAdded={() => setEntRefresh((n) => n + 1)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Duplicate from plan unavailable
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* ── Credit Grants section ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">
                {creditGrants.length > 0
                  ? `${creditGrants.length} Credit Grant${creditGrants.length !== 1 ? "s" : ""}`
                  : "No Credit Grants"}
              </h3>
              <AddCreditGrantDialog
                plan={plan}
                onAdded={() => setCgRefresh((n) => n + 1)}
                existingIds={creditGrants.map((g) => g.creditTypeId)}
              />
            </div>
            {cgLoading ? (
              <SkeletonTable rows={3} cols={3} />
            ) : creditGrants.length > 0 ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Credit Type
                      </th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Amount
                      </th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {creditGrants.map((grant) => (
                      <tr
                        key={grant.creditTypeId}
                        className="border-b border-border last:border-0 hover:bg-secondary/10"
                      >
                        <td className="py-3 px-4 font-medium flex items-center gap-2">
                          <Coins className="w-3.5 h-3.5 text-foreground" />
                          {grant.name ?? grant.creditTypeId}
                          {grant.code ? (
                            <span className="text-xs text-muted-foreground font-mono">
                              {grant.code}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-foreground">
                          {grant.amount} {grant.unitName ?? "credits"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-secondary"
                            onClick={() =>
                              deleteCreditGrant(grant.creditTypeId)
                            }
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-xl p-5 flex items-center justify-between bg-secondary/10">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🪙</span>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      No Credit Grants
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      Add credit grant to this plan to allocate credits to
                      subscribers.
                    </p>
                  </div>
                </div>
                <AddCreditGrantDialog
                  plan={plan}
                  onAdded={() => setCgRefresh((n) => n + 1)}
                  existingIds={creditGrants.map((g) => g.creditTypeId)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Subscribed Companies</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={loadCompanies}
              disabled={companiesLoading}
            >
              <RefreshCw
                className={cn(
                  "w-4 h-4 mr-2",
                  companiesLoading && "animate-spin",
                )}
              />
              Refresh
            </Button>
          </div>
          {companiesLoading ? (
            <SkeletonTable rows={3} cols={4} />
          ) : subscribedCompanies.length > 0 ? (
            <div className="border border-border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead>Identity</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subscribedCompanies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {company.name}
                          </p>
                          {company.email ? (
                            <p className="text-xs text-muted-foreground">
                              {company.email}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {company.walletAddress ? (
                            <p className="font-mono">
                              {company.walletAddress.slice(0, 8)}…
                              {company.walletAddress.slice(-6)}
                            </p>
                          ) : null}
                          {company.externalId ? (
                            <p>ID: {company.externalId}</p>
                          ) : null}
                          {!company.walletAddress &&
                          !company.externalId &&
                          !company.email ? (
                            <p>Internal record</p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(company.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(company.lastSeenAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-xl py-16 flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
                <Package className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground">
                No companies on this plan
              </p>
              <p className="text-xs text-muted-foreground max-w-xs text-center">
                Companies with{" "}
                <code className="bg-secondary px-1 rounded">
                  activePlanId = {plan.id}
                </code>{" "}
                will appear here.
              </p>
            </div>
          )}
        </div>
      )}

      {detailTab === "billing" && (
        <div className="space-y-4">
          {/* Billing info grid */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="text-base font-semibold">Billing Details</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Monthly price
                </p>
                <p className="text-lg font-semibold">
                  {isFree ? (
                    <span className="text-foreground">Free</span>
                  ) : (
                    `$${parseFloat(plan.price).toFixed(2)}`
                  )}
                </p>
                {!isFree && (
                  <p className="text-xs text-muted-foreground">USDC / mo</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Annual price
                </p>
                {plan.annualPrice && parseFloat(plan.annualPrice) > 0 ? (
                  <>
                    <p className="text-lg font-semibold">
                      ${parseFloat(plan.annualPrice).toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      USDC / yr
                      {parseFloat(plan.price) > 0 && (
                        <span className="ml-1.5 text-foreground font-medium">
                          {Math.round(
                            (1 -
                              parseFloat(plan.annualPrice) /
                                (parseFloat(plan.price) * 12)) *
                              100,
                          )}
                          % off
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Billing interval
                </p>
                <p className="text-lg font-semibold">
                  {billingIntervalLabel(plan.billingInterval)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {BILLING_INTERVALS.find(
                    (interval) => interval.seconds === plan.billingInterval,
                  )?.sublabel ??
                    `Every ${Math.round(plan.billingInterval / SECONDS_PER_DAY)} days`}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Token</p>
                <p className="text-sm font-medium">
                  {isFree
                    ? "Free"
                    : TOKEN_OPTIONS.find(
                        (t) => t.address.toLowerCase() === plan.acceptedToken?.toLowerCase(),
                      )?.symbol ?? "Token"}
                </p>
                {!isFree && (
                  <p className="text-xs font-mono text-muted-foreground">
                    {plan.acceptedToken?.slice(0, 6)}…
                    {plan.acceptedToken?.slice(-4)}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-2 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Environment
                </p>
                <EnvBadge mode={plan.environmentMode} />
              </div>
            </div>
          </div>

          {/* On-chain status card */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">On-Chain Status</h3>
              {plan.chainSyncStatus && (
                <ChainSyncBadge status={plan.chainSyncStatus} />
              )}
            </div>

            {plan.chainSyncStatus === "NOT_APPLICABLE" ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-secondary/40 border border-border">
                <Package className="w-5 h-5 text-muted-foreground shrink-0" />
                <p className="text-sm text-muted-foreground">
                  This is a free plan — no on-chain registration required.
                </p>
              </div>
            ) : plan.chainSyncStatus === "SYNCED" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-foreground text-sm font-medium">
                  <Check className="w-4 h-4" />
                  Registered on-chain
                </div>
                {plan.onChainPlanId && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/40 border border-border">
                    <p className="text-xs text-muted-foreground">
                      On-chain Plan ID:
                    </p>
                    <code className="text-xs font-mono text-foreground">
                      {plan.onChainPlanId}
                    </code>
                  </div>
                )}
              </div>
            ) : plan.chainSyncStatus === "PENDING" ? (
              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary border border-border">
                <div className="flex items-center gap-2 text-warning text-sm">
                  <Loader2 className="w-4 h-4" />
                  Pending on-chain sync
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-border text-warning hover:bg-secondary"
                  onClick={() =>
                    toast.info("Use the sync button in the plans list")
                  }
                >
                  Sync on-chain
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-destructive text-sm p-4 rounded-lg bg-secondary border border-border">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <div>
                  <p className="font-medium">Sync failed</p>
                  {plan.chainSyncError && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {plan.chainSyncError}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AddOn Detail View ──────────────────────────────────────────────────────────

function AddOnDetailView({
  addon,
  onBack,
  onUpdated,
}: {
  addon: CatalogAddOn;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const { address, chainId: walletChainId } = useAccount();
  const [detailTab, setDetailTab] = useState<"companies" | "billing">(
    "companies",
  );
  const [copiedId, setCopiedId] = useState(false);
  const [copiedCheckout, setCopiedCheckout] = useState(false);
  const [grantRows, setGrantRows] = useState<
    Array<{
      id: string;
      status: string;
      source: string;
      grantedAt: string;
      expiresAt?: string | null;
      cancelAtPeriodEnd: boolean;
      company: {
        id: string;
        name: string;
        email?: string | null;
        walletAddress?: string | null;
      };
      payment?: {
        txHash?: string | null;
        amount?: string | null;
        currency?: string | null;
      } | null;
    }>
  >([]);
  const [grantsLoading, setGrantsLoading] = useState(true);
  const [creatingCheckoutLink, setCreatingCheckoutLink] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadGrants() {
      try {
        setGrantsLoading(true);
        const res = await fetch(`/api/catalog/add-ons/${addon.id}/grants`, {
          cache: "no-store",
        });
        const payload = (await res.json()) as {
          grants?: Array<{
            id: string;
            status: string;
            source: string;
            grantedAt: string;
            expiresAt?: string | null;
            cancelAtPeriodEnd: boolean;
            company: {
              id: string;
              name: string;
              email?: string | null;
              walletAddress?: string | null;
            };
            payment?: {
              txHash?: string | null;
              amount?: string | null;
              currency?: string | null;
            } | null;
          }>;
        };
        if (!cancelled) {
          setGrantRows(Array.isArray(payload.grants) ? payload.grants : []);
        }
      } catch {
        if (!cancelled) setGrantRows([]);
      } finally {
        if (!cancelled) setGrantsLoading(false);
      }
    }

    void loadGrants();
    return () => {
      cancelled = true;
    };
  }, [addon.id]);

  function copyId() {
    navigator.clipboard.writeText(addon.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  function copyCheckoutUrl() {
    if (!addon.purchaseUrl) return;
    navigator.clipboard.writeText(addon.purchaseUrl);
    setCopiedCheckout(true);
    setTimeout(() => setCopiedCheckout(false), 2000);
  }

  async function ensureCheckoutLink() {
    if (addon.purchaseUrl) {
      copyCheckoutUrl();
      return;
    }
    if (!address) {
      toast.error(
        "Connect the provider wallet you want to receive payments with before creating a checkout link.",
      );
      return;
    }
    setCreatingCheckoutLink(true);
    try {
      const res = await fetch("/api/v1/payment-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "ADDON",
          name: addon.name,
          catalogAddOnId: addon.id,
          recipientWallet: address,
        }),
      });
      const payload = (await res.json()) as {
        error?: string;
        paymentLink?: { checkoutUrl?: string | null };
      };
      if (!res.ok) {
        throw new Error(payload.error || "Unable to create checkout link.");
      }
      if (payload.paymentLink?.checkoutUrl) {
        navigator.clipboard.writeText(payload.paymentLink.checkoutUrl);
        setCopiedCheckout(true);
        setTimeout(() => setCopiedCheckout(false), 2000);
      }
      toast.success("Hosted checkout link ready");
      onUpdated();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create checkout link",
      );
    } finally {
      setCreatingCheckoutLink(false);
    }
  }

  const priceLabel = `$${parseFloat(addon.price).toFixed(2)} ${
    addon.billingType === "ONE_TIME"
      ? "one-time"
      : addon.billingIntervalDays
        ? `every ${addon.billingIntervalDays} days`
        : "recurring"
  }`;

  const DETAIL_TABS = ["companies", "billing"] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          ADD-ONS
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium uppercase">
          {addon.name}
        </span>
      </div>

      {/* Add-on header card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground leading-tight">
                {addon.name}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last modified {timeAgo(addon.updatedAt)}
              </p>
            </div>
          </div>

          {/* Right: badges + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="text-xs gap-1">
              <Package className="w-3 h-3" />
              Add-on
            </Badge>
            <Badge variant="secondary" className="text-xs font-semibold">
              {priceLabel}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {addon.saleMode === "STANDALONE"
                ? "Standalone"
                : addon.saleMode === "UPSELL"
                  ? "Upsell"
                  : "Standalone + upsell"}
            </Badge>
            <StatusBadge status={addon.status} />
            <div className="h-6 w-px bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <EditAddOnDialog addon={addon} onSaved={onUpdated} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyId}>
                    {copiedId ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-2 text-foreground" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        Copy Add-On ID
                      </>
                    )}
                  </DropdownMenuItem>
                  {addon.billingType === "ONE_TIME" &&
                    addon.saleMode !== "UPSELL" && (
                      <DropdownMenuItem
                        onClick={() => void ensureCheckoutLink()}
                      >
                        {creatingCheckoutLink ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                            Creating checkout link…
                          </>
                        ) : copiedCheckout ? (
                          <>
                            <Check className="w-3.5 h-3.5 mr-2 text-foreground" />
                            Checkout link copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 mr-2" />
                            {addon.purchaseUrl
                              ? "Copy checkout link"
                              : "Create checkout link"}
                          </>
                        )}
                      </DropdownMenuItem>
                    )}
                  {addon.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/add-ons", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: addon.id,
                            status: "PUBLISHED",
                          }),
                        });
                        onUpdated();
                        toast.success("Add-on published");
                      }}
                    >
                      Publish Add-On
                    </DropdownMenuItem>
                  )}
                  {addon.status !== "ARCHIVED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/add-ons", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: addon.id,
                            status: "ARCHIVED",
                          }),
                        });
                        onUpdated();
                        toast.success("Add-on archived");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Archive Add-On
                    </DropdownMenuItem>
                  )}
                  {addon.status !== "PUBLISHED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/add-ons", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: addon.id }),
                        });
                        onUpdated();
                        toast.success("Add-on deleted");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Delete Permanently
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {addon.description && (
        <p className="text-sm text-muted-foreground -mt-2">
          {addon.description}
        </p>
      )}

      {/* Detail tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-all -mb-px ${
                detailTab === tab
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              Companies with this Add-On
            </h3>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    Company
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    Subscribed Since
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {grantsLoading ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="py-12 text-center text-sm text-muted-foreground"
                    >
                      Loading purchases…
                    </td>
                  </tr>
                ) : grantRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
                          <Package className="w-6 h-6 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          No companies on this add-on yet
                        </p>
                        <p className="text-xs text-muted-foreground max-w-xs text-center">
                          Companies that purchase this add-on or receive it as
                          an upsell will appear here.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  grantRows.map((grant) => (
                    <tr key={grant.id} className="border-t border-border/40">
                      <td className="py-3 px-4">
                        <div className="font-medium text-foreground">
                          {grant.company.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {grant.company.email ||
                            grant.company.walletAddress ||
                            grant.source}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">
                        {new Date(grant.grantedAt).toLocaleDateString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              grant.status === "ACTIVE"
                                ? "secondary"
                                : "outline"
                            }
                          >
                            {grant.status.toLowerCase()}
                          </Badge>
                          {grant.cancelAtPeriodEnd && (
                            <span className="text-[11px] text-muted-foreground">
                              ends at renewal
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailTab === "billing" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="text-base font-semibold">Billing Details</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Price</p>
                <p className="text-lg font-semibold">
                  ${parseFloat(addon.price).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">USDC</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Billing Type
                </p>
                <p className="text-sm font-semibold">
                  {addon.billingType === "ONE_TIME" ? "One-time" : "Recurring"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {addon.saleMode === "STANDALONE"
                    ? "Standalone checkout"
                    : addon.saleMode === "UPSELL"
                      ? "Subscriber upsell"
                      : "Standalone + upsell"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Cadence</p>
                <p className="text-sm font-semibold">
                  {addon.billingType === "RECURRING"
                    ? addon.billingIntervalDays
                      ? `${addon.billingIntervalDays} days`
                      : "Recurring"
                    : "One-time"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Token</p>
                <p className="text-sm font-medium">USDC</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {addon.acceptedToken.slice(0, 6)}…
                  {addon.acceptedToken.slice(-4)}
                </p>
              </div>
            </div>
            {addon.billingType === "ONE_TIME" &&
              addon.saleMode !== "UPSELL" && (
                <div className="rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        Hosted checkout
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Create or copy a public{" "}
                        {getChainLabel(walletChainId ?? DEFAULT_CHAIN_ID)} pay link for this
                        add-on.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void ensureCheckoutLink()}
                      disabled={creatingCheckoutLink}
                    >
                      {creatingCheckoutLink ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
                          Preparing…
                        </>
                      ) : addon.purchaseUrl ? (
                        copiedCheckout ? (
                          "Copied"
                        ) : (
                          "Copy checkout link"
                        )
                      ) : (
                        "Create checkout link"
                      )}
                    </Button>
                  </div>
                  {addon.purchaseUrl && (
                    <p className="mt-3 break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
                      {addon.purchaseUrl}
                    </p>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Credit Detail View ─────────────────────────────────────────────────────────

function CreateBundleDialog({
  creditId,
  onCreated,
  bundle,
}: {
  creditId: string;
  onCreated: () => void;
  bundle?: { id: string; name: string; units: number; price: number };
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(bundle?.name || "");
  const [units, setUnits] = useState(bundle?.units.toString() || "100");
  const [price, setPrice] = useState(bundle?.price.toString() || "10");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/credits/${creditId}/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: bundle?.id,
          name,
          units: parseInt(units),
          price: parseFloat(price),
        }),
      });
      if (res.ok) {
        onCreated();
        setOpen(false);
        if (!bundle) {
          setName("");
          setUnits("100");
          setPrice("10");
        }
        toast.success(bundle ? "Bundle updated" : "Bundle created");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {bundle ? (
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 font-medium">
            <Plus className="w-3.5 h-3.5" />
            Create bundle
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {bundle ? "Edit Bundle" : "Create Credit Bundle"}
          </DialogTitle>
          <DialogDescription>
            Bundles allow customers to purchase a pack of credits.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Bundle Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starter Pack"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Units</Label>
              <Input
                type="number"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                min="1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>Price (USDC)</Label>
              <Input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min="0.01"
                step="0.01"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              {bundle ? "Save Changes" : "Create Bundle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddPlanGrantDialog({
  creditId,
  onAdded,
  existingPlanIds,
}: {
  creditId: string;
  onAdded: () => void;
  existingPlanIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [amount, setAmount] = useState("50");
  const { envMode } = useEnvironment();

  useEffect(() => {
    if (open) {
      fetch(`/api/catalog/plans?environmentMode=${envMode}&status=PUBLISHED`)
        .then((res) => res.json())
        .then((data) => setPlans(data.plans ?? []));
    }
  }, [open, envMode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPlanId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/catalog/credits/${creditId}/plan-grants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanId,
          amount: parseFloat(amount),
        }),
      });
      if (res.ok) {
        onAdded();
        setOpen(false);
        toast.success("Plan grant added");
      }
    } finally {
      setLoading(false);
    }
  }

  const availablePlans = plans.filter((p) => !existingPlanIds.includes(p.id));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-medium">
          <Plus className="w-3.5 h-3.5" />
          Add plan grant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Plan Grant</DialogTitle>
          <DialogDescription>
            Grant credits automatically to subscribers of a specific plan.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Select Plan</Label>
            <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a plan" />
              </SelectTrigger>
              <SelectContent>
                {availablePlans.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No available plans
                  </div>
                ) : (
                  availablePlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Amount</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0.000001"
              step="any"
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !selectedPlanId}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Add Grant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreditDetailView({
  credit,
  onBack,
  onUpdated,
}: {
  credit: CatalogCreditType;
  onBack: () => void;
  onUpdated: () => void;
}) {
  const [detailTab, setDetailTab] = useState<"entitlements" | "companies">(
    "entitlements",
  );
  const [copiedId, setCopiedId] = useState(false);
  const [bundles, setBundles] = useState<any[]>([]);
  const [planGrants, setPlanGrants] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const loadData = useCallback(async () => {
    setLoadingData(true);
    try {
      const [bRes, pRes] = await Promise.all([
        fetch(`/api/catalog/credits/${credit.id}/bundles`),
        fetch(`/api/catalog/credits/${credit.id}/plan-grants`),
      ]);
      if (bRes.ok) {
        const d = await bRes.json();
        setBundles(d.bundles ?? []);
      }
      if (pRes.ok) {
        const d = await pRes.json();
        setPlanGrants(d.planGrants ?? []);
      }
    } finally {
      setLoadingData(false);
    }
  }, [credit.id]);

  useEffect(() => {
    loadData();
  }, [loadData, refresh]);

  async function deleteBundle(bundleId: string) {
    if (!window.confirm("Remove this bundle?")) return;
    try {
      await fetch(
        `/api/catalog/credits/${credit.id}/bundles?bundleId=${bundleId}`,
        {
          method: "DELETE",
        },
      );
      setRefresh((n) => n + 1);
      toast.success("Bundle removed");
    } catch {
      toast.error("Failed to remove bundle");
    }
  }

  async function deletePlanGrant(planId: string) {
    if (!window.confirm("Remove this plan grant?")) return;
    try {
      await fetch(
        `/api/catalog/credits/${credit.id}/plan-grants?planId=${planId}`,
        {
          method: "DELETE",
        },
      );
      setRefresh((n) => n + 1);
      toast.success("Plan grant removed");
    } catch {
      toast.error("Failed to remove plan grant");
    }
  }

  function copyId() {
    navigator.clipboard.writeText(credit.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  const DETAIL_TABS = ["entitlements", "companies"] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          CREDITS
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium uppercase">
          {credit.name}
        </span>
      </div>

      {/* Credit header card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Left: icon + name + meta */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center shrink-0">
              <Coins className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground leading-tight">
                {credit.name}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last modified {timeAgo(credit.updatedAt)}
              </p>
            </div>
          </div>

          {/* Right: badges + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant="outline" className="text-xs gap-1 font-mono">
              {credit.code}
            </Badge>
            <Badge variant="secondary" className="text-xs font-semibold">
              {credit.unitsPerPack} {credit.unitName} for $
              {parseFloat(credit.price).toFixed(2)}
            </Badge>
            <StatusBadge status={credit.status} />
            <div className="h-6 w-px bg-border hidden sm:block" />
            {/* Actions */}
            <div className="flex items-center gap-2">
              <EditCreditTypeDialog credit={credit} onSaved={onUpdated} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyId}>
                    {copiedId ? (
                      <>
                        <Check className="w-3.5 h-3.5 mr-2 text-foreground" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        Copy Credit ID
                      </>
                    )}
                  </DropdownMenuItem>
                  {credit.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/credits", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: credit.id,
                            status: "PUBLISHED",
                          }),
                        });
                        onUpdated();
                        toast.success("Credit type published");
                      }}
                    >
                      Publish
                    </DropdownMenuItem>
                  )}
                  {credit.status !== "ARCHIVED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/credits", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: credit.id,
                            status: "ARCHIVED",
                          }),
                        });
                        onUpdated();
                        toast.success("Credit type archived");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Archive
                    </DropdownMenuItem>
                  )}
                  {credit.status !== "PUBLISHED" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/credits", {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: credit.id }),
                        });
                        onUpdated();
                        toast.success("Credit type deleted");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-2" />
                      Delete Permanently
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Detail tabs */}
      <div className="border-b border-border">
        <div className="flex gap-0">
          {DETAIL_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-3 text-sm font-medium capitalize border-b-2 transition-all -mb-px ${
                detailTab === tab
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {detailTab === "entitlements" && (
        <div className="space-y-6">
          {/* ── Credit Bundles ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Credit Bundles</h3>
              <CreateBundleDialog
                creditId={credit.id}
                onCreated={() => setRefresh((n) => n + 1)}
              />
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : bundles.length > 0 ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Bundle Name
                      </th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Units
                      </th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Price
                      </th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {bundles.map((b) => (
                      <tr
                        key={b.id}
                        className="border-b border-border last:border-0 hover:bg-secondary/10"
                      >
                        <td className="py-3 px-4 font-medium">{b.name}</td>
                        <td className="py-3 px-4">{b.units} units</td>
                        <td className="py-3 px-4 text-foreground font-medium">
                          ${parseFloat(b.price).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right flex items-center justify-end gap-1">
                          <CreateBundleDialog
                            creditId={credit.id}
                            bundle={b}
                            onCreated={() => setRefresh((n) => n + 1)}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-secondary"
                            onClick={() => deleteBundle(b.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-xl py-12 flex flex-col items-center justify-center gap-2 bg-secondary/10">
                <Coins className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  No credit bundles yet
                </p>
                <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
                  Bundles allow customers to purchase a pack of{" "}
                  {credit.unitsPerPack} {credit.unitName} for $
                  {parseFloat(credit.price).toFixed(2)}.
                </p>
              </div>
            )}
          </div>

          {/* ── Plan Grants ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Plan Grants</h3>
              <AddPlanGrantDialog
                creditId={credit.id}
                onAdded={() => setRefresh((n) => n + 1)}
                existingPlanIds={planGrants.map((g) => g.planId)}
              />
            </div>
            {loadingData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : planGrants.length > 0 ? (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 border-b border-border">
                    <tr>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Plan
                      </th>
                      <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">
                        Amount
                      </th>
                      <th className="w-12" />
                    </tr>
                  </thead>
                  <tbody>
                    {planGrants.map((grant) => (
                      <tr
                        key={grant.planId}
                        className="border-b border-border last:border-0 hover:bg-secondary/10"
                      >
                        <td className="py-3 px-4 font-medium flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-foreground" />
                          {grant.planName ?? grant.planId}
                          {grant.planTier ? (
                            <span className="text-xs text-muted-foreground font-mono">
                              {grant.planTier}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 px-4 text-foreground">
                          {grant.amount} units
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-secondary"
                            onClick={() => deletePlanGrant(grant.planId)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border border-dashed border-border rounded-xl py-12 flex flex-col items-center justify-center gap-2 bg-secondary/10">
                <Package className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">
                  No plan grants yet
                </p>
                <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
                  Plan grants automatically allocate {credit.unitName} credits
                  to subscribers of specific plans.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              Companies with Credit Grants
            </h3>
          </div>
          <div className="border border-dashed border-border rounded-xl py-16 flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
              <Coins className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground">
              No companies yet
            </p>
            <p className="text-xs text-muted-foreground max-w-xs text-center">
              Companies that have been granted {credit.unitName} credits will
              appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Unified Catalog Section ───────────────────────────────────────────────────

type CatalogTab = "plans" | "addons" | "credits" | "config";

export function CatalogSection() {
  const { envMode, activeEnvironment } = useEnvironment();
  const environmentKey = activeEnvironment?.id ?? envMode;
  const [activeTab, setActiveTab] = useState<CatalogTab>("plans");
  const [refresh, setRefresh] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<CatalogPlan | null>(null);
  const [selectedAddOn, setSelectedAddOn] = useState<CatalogAddOn | null>(null);
  const [selectedCredit, setSelectedCredit] =
    useState<CatalogCreditType | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [addOns, setAddOns] = useState<CatalogAddOn[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [addOnsLoading, setAddOnsLoading] = useState(true);
  const [planSearch, setPlanSearch] = useState("");
  const [addOnSearch, setAddOnSearch] = useState("");
  const [updatingAddOnId, setUpdatingAddOnId] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans?environmentMode=${envMode}`);
      if (res.ok) {
        const d = await res.json();
        setPlans(d.plans ?? []);
      }
    } finally {
      setPlansLoading(false);
    }
  }, [envMode, environmentKey]);

  const loadAddOns = useCallback(async () => {
    setAddOnsLoading(true);
    try {
      const res = await fetch(
        `/api/catalog/add-ons?environmentMode=${envMode}`,
      );
      if (res.ok) {
        const d = await res.json();
        setAddOns(d.addOns ?? []);
      }
    } finally {
      setAddOnsLoading(false);
    }
  }, [envMode, environmentKey]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans, refresh]);
  useEffect(() => {
    loadAddOns();
  }, [loadAddOns, refresh]);

  function tr() {
    setRefresh((n) => n + 1);
  }

  const filteredPlans = plans.filter((p) =>
    p.name.toLowerCase().includes(planSearch.toLowerCase()),
  );
  const filteredAddOns = addOns.filter((a) =>
    a.name.toLowerCase().includes(addOnSearch.toLowerCase()),
  );

  async function archiveAddOn(id: string) {
    setUpdatingAddOnId(id);
    try {
      await fetch("/api/catalog/add-ons", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: "ARCHIVED" }),
      });
      tr();
      toast.success("Add-on archived");
    } finally {
      setUpdatingAddOnId(null);
    }
  }

  // Plan detail view
  if (selectedPlan) {
    return (
      <PlanDetailView
        plan={selectedPlan}
        onBack={() => setSelectedPlan(null)}
        onUpdated={() => {
          loadPlans();
          setSelectedPlan(null);
        }}
      />
    );
  }

  // Add-on detail view
  if (selectedAddOn) {
    return (
      <AddOnDetailView
        addon={selectedAddOn}
        onBack={() => setSelectedAddOn(null)}
        onUpdated={() => {
          loadAddOns();
          setSelectedAddOn(null);
        }}
      />
    );
  }

  // Credit detail view
  if (selectedCredit) {
    return (
      <CreditDetailView
        credit={selectedCredit}
        onBack={() => setSelectedCredit(null)}
        onUpdated={() => {
          tr();
          setSelectedCredit(null);
        }}
      />
    );
  }

  const TABS: { key: CatalogTab; label: string; count?: number }[] = [
    { key: "plans", label: "Plan", count: plans.length },
    { key: "addons", label: "Add-on", count: addOns.length },
    { key: "credits", label: "Credit Types" },
    { key: "config", label: "Configuration" },
  ];

  return (
    <div className="space-y-0">
      {/* Tab bar header */}
      <div className="flex items-center justify-between border-b border-border pb-0 mb-6">
        <div className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-all -mb-px flex items-center gap-1.5 ${
                activeTab === tab.key
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.count !== undefined
                ? `${tab.count} ${tab.label}${tab.count !== 1 ? "s" : ""}`
                : tab.label}
            </button>
          ))}
        </div>

        {/* Right-side actions per tab */}
        <div className="flex items-center gap-2 pb-3">
          {activeTab === "plans" && (
            <>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search plans"
                  value={planSearch}
                  onChange={(e) => setPlanSearch(e.target.value)}
                  className="h-9 w-44 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <CreatePlanDialog env={envMode} onCreated={tr} />
            </>
          )}
          {activeTab === "addons" && (
            <>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search add-ons"
                  value={addOnSearch}
                  onChange={(e) => setAddOnSearch(e.target.value)}
                  className="h-9 w-44 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
              <CreateAddOnDialog env={envMode} onCreated={tr} />
            </>
          )}
          {activeTab === "credits" && (
            <CreateCreditTypeDialog env={envMode} onCreated={tr} />
          )}
          {activeTab === "config" && <div />}
        </div>
      </div>

      {/* Plans Tab */}
      {activeTab === "plans" && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Plan
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Features
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Prices
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {plansLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="py-4 px-4">
                          <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                        </td>
                      ))}
                      <td className="py-4 px-4" />
                    </tr>
                  ))}
                {!plansLoading && filteredPlans.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-16 text-center text-sm text-muted-foreground"
                    >
                      No plans found. Create your first plan above.
                    </td>
                  </tr>
                )}
                {!plansLoading &&
                  filteredPlans.map((plan) => {
                    const entitlements = (() => {
                      try {
                        const meta = plan as unknown as {
                          metadata?: { entitlements?: unknown[] };
                        };
                        return Array.isArray(meta.metadata?.entitlements)
                          ? meta.metadata.entitlements.length
                          : 0;
                      } catch {
                        return 0;
                      }
                    })();
                    return (
                      <tr
                        key={plan.id}
                        onClick={() => setSelectedPlan(plan)}
                        className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer"
                      >
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-accent/30 to-accent/10 border border-border flex items-center justify-center text-sm font-bold text-accent"></div>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {plan.name}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {plan.id.slice(0, 16)}…
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm text-muted-foreground">
                            {entitlements > 0
                              ? `${entitlements} entitlement${entitlements !== 1 ? "s" : ""}`
                              : "—"}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <span className="text-sm">
                              ${parseFloat(plan.price).toFixed(2)} /{" "}
                              {billingIntervalLabel(plan.billingInterval)}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <StatusBadge status={plan.status} />
                        </td>
                        <td
                          className="py-4 px-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                              >
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => setSelectedPlan(plan)}
                              >
                                <ChevronRight className="w-3.5 h-3.5 mr-2" />
                                View Details
                              </DropdownMenuItem>
                              {plan.status === "DRAFT" && (
                                <DropdownMenuItem
                                  onClick={async () => {
                                    await fetch("/api/catalog/plans", {
                                      method: "PUT",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        id: plan.id,
                                        status: "PUBLISHED",
                                      }),
                                    });
                                    tr();
                                    toast.success("Plan published");
                                  }}
                                >
                                  Publish
                                </DropdownMenuItem>
                              )}
                              {plan.status !== "ARCHIVED" && (
                                <DropdownMenuItem
                                  onClick={async () => {
                                    await fetch("/api/catalog/plans", {
                                      method: "PUT",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        id: plan.id,
                                        status: "ARCHIVED",
                                      }),
                                    });
                                    tr();
                                    toast.success("Plan archived");
                                  }}
                                  className="text-destructive focus:text-destructive"
                                >
                                  Archive
                                </DropdownMenuItem>
                              )}
                              {!plan.onChainPlanId &&
                                plan.status !== "PUBLISHED" && (
                                  <DropdownMenuItem
                                    onClick={async () => {
                                      const confirmed = window.confirm(
                                        `Delete plan "${plan.name}"? This cannot be undone.`,
                                      );
                                      if (!confirmed) return;
                                      const res = await fetch(
                                        "/api/catalog/plans",
                                        {
                                          method: "DELETE",
                                          headers: {
                                            "Content-Type": "application/json",
                                          },
                                          body: JSON.stringify({ id: plan.id }),
                                        },
                                      );
                                      const data = await res
                                        .json()
                                        .catch(
                                          () => ({}) as { error?: string },
                                        );
                                      if (!res.ok) {
                                        toast.error(
                                          data.error || "Failed to delete plan",
                                        );
                                        return;
                                      }
                                      tr();
                                      toast.success("Plan deleted");
                                    }}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    Delete
                                  </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
            <span className="text-sm text-muted-foreground">
              Showing {filteredPlans.length} plan
              {filteredPlans.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Add-Ons Tab */}
      {activeTab === "addons" && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Add On
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Code
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Prices
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody>
                {addOnsLoading &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      {Array.from({ length: 4 }).map((__, j) => (
                        <td key={j} className="py-4 px-4">
                          <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                        </td>
                      ))}
                      <td className="py-4 px-4" />
                    </tr>
                  ))}
                {!addOnsLoading && filteredAddOns.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-16 text-center text-sm text-muted-foreground"
                    >
                      No add-ons found. Create your first add-on above.
                    </td>
                  </tr>
                )}
                {!addOnsLoading &&
                  filteredAddOns.map((addon) => (
                    <tr
                      key={addon.id}
                      onClick={(e) => {
                        if (
                          (e.target as HTMLElement).closest("button") ||
                          (e.target as HTMLElement).closest("[role='menuitem']")
                        )
                          return;
                        setSelectedAddOn(addon);
                      }}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/10 border border-border flex items-center justify-center"></div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {addon.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {addon.description ?? ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <code className="text-xs font-mono text-muted-foreground">
                          {addon.code}
                        </code>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-sm">
                          ${parseFloat(addon.price).toFixed(2)} ·{" "}
                          {addon.billingType === "ONE_TIME"
                            ? "One-time"
                            : "Recurring"}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <StatusBadge status={addon.status} />
                      </td>
                      <td className="py-4 px-4">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={updatingAddOnId === addon.id}
                            >
                              {updatingAddOnId === addon.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="w-4 h-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {addon.status === "DRAFT" && (
                              <DropdownMenuItem
                                onClick={async () => {
                                  setUpdatingAddOnId(addon.id);
                                  await fetch("/api/catalog/add-ons", {
                                    method: "PUT",
                                    headers: {
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      id: addon.id,
                                      status: "PUBLISHED",
                                    }),
                                  });
                                  setUpdatingAddOnId(null);
                                  tr();
                                  toast.success("Add-on published");
                                }}
                              >
                                Publish
                              </DropdownMenuItem>
                            )}
                            {addon.status !== "ARCHIVED" && (
                              <DropdownMenuItem
                                onClick={() => archiveAddOn(addon.id)}
                                className="text-destructive focus:text-destructive"
                              >
                                Archive
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
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/20">
            <span className="text-sm text-muted-foreground">
              Showing {filteredAddOns.length} add-on
              {filteredAddOns.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Credit Types Tab */}
      {activeTab === "credits" && (
        <CreditTypesTable
          env={envMode}
          refresh={refresh}
          onSelect={(ct) => {
            setSelectedCredit(ct);
          }}
        />
      )}

      {/* Configuration Tab */}
      {activeTab === "config" && <ConfigurationTab />}
    </div>
  );
}

// ─── Standalone section exports (used by page.tsx routing) ────────────────────

export function CatalogPlansSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<CatalogPlan | null>(null);

  function tr() {
    setRefresh((n) => n + 1);
  }

  if (selectedPlan) {
    return (
      <PlanDetailView
        plan={selectedPlan}
        onBack={() => setSelectedPlan(null)}
        onUpdated={() => {
          tr();
          setSelectedPlan(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-foreground mb-1">Plans</h2>
          <p className="text-sm text-muted-foreground">
            Create and manage subscription plans. Click a plan to configure
            entitlements, companies, and billing.
          </p>
        </div>
        <CreatePlanDialog env={envMode} onCreated={tr} />
      </div>
      <PlansTable env={envMode} refresh={refresh} onSelect={setSelectedPlan} />
    </div>
  );
}
