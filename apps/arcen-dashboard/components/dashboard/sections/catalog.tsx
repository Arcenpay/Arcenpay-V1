"use client";

import React, { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvironment } from "@/contexts/environment-context";
import { useAccount, useSignTypedData, useChainId } from "wagmi";
import { getUsdcAddress, getUsdcTokenOptions } from "@/lib/contracts";
import { DEFAULT_TESTNET_CHAIN_ID } from "@/lib/default-chain";
import { toast } from "sonner";

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
}

interface CatalogAddOn {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  billingType: "ONE_TIME" | "RECURRING";
  price: string;
  acceptedToken: string;
  environmentMode: EnvMode;
  status: CatalogStatus;
  active: boolean;
  version: number;
  publishedAt?: string | null;
  updatedAt: string;
}

interface CatalogCreditType {
  id: string;
  name: string;
  code: string;
  unitName: string;
  unitsPerPack: number;
  price: string;
  acceptedToken: string;
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
  signingRequired?: boolean;
}

// ─── Token Options ────────────────────────────────────────────────────────────

const USDC_CHAIN_OPTIONS = getUsdcTokenOptions();

const TOKEN_OPTIONS: { label: string; address: string }[] =
  USDC_CHAIN_OPTIONS.map((option) => ({
    label: option.label,
    address: option.address,
  }));

const DEFAULT_TOKEN = getUsdcAddress(DEFAULT_TESTNET_CHAIN_ID);

const BILLING_INTERVALS: { label: string; days: number; sublabel: string }[] = [
  { label: "Monthly", days: 30, sublabel: "Every 30 days" },
  { label: "Quarterly", days: 90, sublabel: "Every 90 days" },
  { label: "Annual", days: 365, sublabel: "Every 365 days" },
];

function tokenLabel(address: string): string {
  const match = TOKEN_OPTIONS.find(
    (t) => t.address.toLowerCase() === address.toLowerCase(),
  );
  return match
    ? match.label.split(" — ")[0] +
        " (" +
        address.slice(0, 6) +
        "…" +
        address.slice(-4) +
        ")"
    : address.slice(0, 10) + "…";
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
          ? "border-orange-400 text-orange-400"
          : "border-blue-400 text-blue-400"
      }
    >
      {mode === "PRODUCTION" ? "PROD" : "DEV"}
    </Badge>
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
        className="text-yellow-600 border-yellow-400 text-xs"
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
  const chainId = useChainId();
  const connectedToken = getUsdcAddress(chainId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [planType, setPlanType] = useState<"free" | "paid">("paid");
  const [billingIntervalDays, setBillingIntervalDays] = useState(30);
  const [hasAnnualPrice, setHasAnnualPrice] = useState(false);
  const [annualDiscount, setAnnualDiscount] = useState("20");
  const [form, setForm] = useState({
    name: "",
    tier: "",
    description: "",
    price: "",
    annualPrice: "",
    acceptedToken: connectedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive tier from name (lowercase slug)
  const autoTier = form.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (planType === "paid") {
      const p = Number(form.price);
      if (!form.price || isNaN(p) || p <= 0) e.price = "Must be a positive number";
      if (hasAnnualPrice) {
        const ap = Number(form.annualPrice);
        if (!form.annualPrice || isNaN(ap) || ap <= 0) e.annualPrice = "Must be a positive number";
      }
    }
    return e;
  }

  function resetForm() {
    setPlanType("paid");
    setBillingIntervalDays(30);
    setHasAnnualPrice(false);
    setAnnualDiscount("20");
    setForm({ name: "", tier: "", description: "", price: "", annualPrice: "", acceptedToken: connectedToken });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
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

  const selectedChainOpt = USDC_CHAIN_OPTIONS.find((o) => o.address === form.acceptedToken);
  const chainName = (o: typeof USDC_CHAIN_OPTIONS[number]) =>
    o.label.replace(/USDC — |Custom USDC — /, "");
  const chainInitial = (o: typeof USDC_CHAIN_OPTIONS[number]) => {
    const n = chainName(o);
    return n.startsWith("Base") ? "B" : n.startsWith("Sepolia") ? "S" : n[0]?.toUpperCase() ?? "?";
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
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
          <button onClick={() => { setOpen(false); resetForm(); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Plan Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">Create Plan</p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0" />
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || <span className="font-normal text-muted-foreground">Untitled plan</span>}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">Plan Preview</p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">{form.name || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{form.description || form.name || "—"}</p>
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {planType === "free" ? "Free" : form.price ? `$${form.price} USDC` : "—"}
                    {planType === "paid" && form.price && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        / {BILLING_INTERVALS.find((i) => i.days === billingIntervalDays)?.label.toLowerCase() ?? `${billingIntervalDays}d`}
                      </span>
                    )}
                  </p>
                  {hasAnnualPrice && form.annualPrice && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      or ${form.annualPrice} USDC / year
                      {form.price && Number(form.annualPrice) < Number(form.price) * 12 && (
                        <span className="text-green-500 ml-1">
                          (save {Math.round((1 - Number(form.annualPrice) / (Number(form.price) * 12)) * 100)}%)
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">No entitlements yet</p>
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
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Plan Settings</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">A company can only have one base plan.</p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Name + Tier */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-2 block">Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: "" })); }}
                      placeholder="e.g. Pro, Starter, Enterprise"
                      className="h-11 bg-background border-border"
                    />
                    {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                  </div>
                  <div className="w-28">
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Tier
                      <span className="text-muted-foreground font-normal ml-1">(auto)</span>
                    </Label>
                    <Input
                      value={form.tier || autoTier}
                      onChange={(e) => setForm({ ...form, tier: e.target.value })}
                      placeholder={autoTier || "pro"}
                      className="h-11 bg-background border-border font-mono text-sm"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Describe this plan"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Optional</p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">Pricing</h3>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/20">
                      {env === "DEVELOPMENT" ? "DEV" : "PROD"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">Set a price or keep it free.</p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <span className="font-medium">{planType === "free" ? "Free" : "Paid"}</span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem onClick={() => { setPlanType("free"); setForm((p) => ({ ...p, price: "" })); }}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Free</p>
                              <p className="text-xs text-muted-foreground">No charge — $0.00 USDC</p>
                            </div>
                            {planType === "free" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPlanType("paid")}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Paid</p>
                              <p className="text-xs text-muted-foreground">Recurring USDC payment</p>
                            </div>
                            {planType === "paid" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Billing Integration</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt ? chainName(selectedChainOpt) : "Select chain"}
                              </span>
                              {selectedChainOpt && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground border border-border"}`}>
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">Connected</span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Testnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "testnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mainnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "mainnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">Switch your wallet network to enable other chains</p>
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
                          <Label className="text-sm font-medium text-foreground mb-2 block">Monthly Price (USDC) *</Label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                            <Input
                              value={form.price}
                              onChange={(e) => { setForm({ ...form, price: e.target.value }); setErrors((p) => ({ ...p, price: "" })); }}
                              placeholder="29.00"
                              type="number"
                              min="0.01"
                              step="0.01"
                              className="h-11 bg-background border-border pl-6"
                            />
                          </div>
                          {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">Billing Interval</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                                <span className="font-medium">{BILLING_INTERVALS.find((i) => i.days === billingIntervalDays)?.label ?? `${billingIntervalDays} days`}</span>
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                              {BILLING_INTERVALS.map((iv) => (
                                <DropdownMenuItem key={iv.days} onClick={() => setBillingIntervalDays(iv.days)} className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">{iv.label}</p>
                                    <p className="text-xs text-muted-foreground">{iv.sublabel}</p>
                                  </div>
                                  {billingIntervalDays === iv.days && <Check className="w-4 h-4 text-foreground ml-2" />}
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
                            <p className="text-sm font-medium text-foreground">Annual Pricing</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Optional discounted rate for yearly subscribers
                            </p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={hasAnnualPrice}
                            onClick={() => {
                              const next = !hasAnnualPrice;
                              setHasAnnualPrice(next);
                              if (!next) {
                                setForm((p) => ({ ...p, annualPrice: "" }));
                              } else if (form.price) {
                                // Auto-seed 20% discount on enable
                                const computed = (Number(form.price) * 12 * 0.8).toFixed(2);
                                setForm((p) => ({ ...p, annualPrice: computed }));
                                setAnnualDiscount("20");
                              }
                            }}
                            className={cn(
                              "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                              hasAnnualPrice ? "bg-primary" : "bg-secondary",
                            )}
                          >
                            <span className={cn(
                              "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg transition-transform",
                              hasAnnualPrice ? "translate-x-5" : "translate-x-0",
                            )} />
                          </button>
                        </div>
                        {hasAnnualPrice && (
                          <div className="mt-4 space-y-3">
                            {/* Discount % row */}
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">Discount off monthly × 12</Label>
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
                                        const computed = (Number(form.price) * 12 * (1 - Number(pct) / 100)).toFixed(2);
                                        setForm((p) => ({ ...p, annualPrice: computed }));
                                        setErrors((p) => ({ ...p, annualPrice: "" }));
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
                                        const pct = Math.min(60, Math.max(0, Number(e.target.value) || 0)).toString();
                                        setAnnualDiscount(pct);
                                        if (form.price) {
                                          const computed = (Number(form.price) * 12 * (1 - Number(pct) / 100)).toFixed(2);
                                          setForm((p) => ({ ...p, annualPrice: computed }));
                                          setErrors((p) => ({ ...p, annualPrice: "" }));
                                        }
                                      }}
                                      className="w-full text-sm text-foreground bg-transparent outline-none"
                                    />
                                    <span className="text-xs text-muted-foreground">%</span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Computed annual price + override */}
                            <div className="flex items-start gap-3">
                              <div className="flex-1">
                                <Label className="text-xs text-muted-foreground mb-1.5 block">Annual price (USDC)</Label>
                                <div className="relative">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                                  <Input
                                    value={form.annualPrice}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      setForm({ ...form, annualPrice: val });
                                      setErrors((p) => ({ ...p, annualPrice: "" }));
                                      // Back-calculate discount
                                      if (form.price && val && Number(val) > 0) {
                                        const backPct = Math.round((1 - Number(val) / (Number(form.price) * 12)) * 100);
                                        if (backPct >= 0 && backPct <= 60) setAnnualDiscount(String(backPct));
                                      }
                                    }}
                                    placeholder={form.price ? (Number(form.price) * 12 * 0.8).toFixed(2) : "278.40"}
                                    type="number"
                                    min="0.01"
                                    step="0.01"
                                    className="h-9 bg-background border-border pl-6 text-sm"
                                  />
                                </div>
                                {errors.annualPrice && <p className="text-xs text-destructive mt-1">{errors.annualPrice}</p>}
                              </div>

                              {form.price && form.annualPrice && Number(form.annualPrice) > 0 && (
                                <div className="pt-6 text-right">
                                  <p className="text-xs font-semibold text-green-500">
                                    {Math.round((1 - Number(form.annualPrice) / (Number(form.price) * 12)) * 100)}% off
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
                                    vs ${(Number(form.price) * 12).toFixed(2)}/yr
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
                  Environment: <strong>{env}</strong> — plan will be created in the catalog.
                  Click &ldquo;Register on-chain&rdquo; after creation to activate it on-chain.
                </p>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); }} disabled={loading}>
            Cancel
          </Button>
          <Button form="create-plan-form" type="submit" disabled={loading} className="min-w-[140px]">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Save Changes"}
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
  const chainId = useChainId();
  const connectedToken = getUsdcAddress(chainId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [billingIntervalDays, setBillingIntervalDays] = useState(30);
  const [form, setForm] = useState({
    name: "",
    description: "",
    billingType: "ONE_TIME" as "ONE_TIME" | "RECURRING",
    price: "",
    acceptedToken: connectedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive code from name
  const autoCode = form.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const selectedChainOpt = USDC_CHAIN_OPTIONS.find((o) => o.address === form.acceptedToken);
  const chainName = (o: typeof USDC_CHAIN_OPTIONS[number]) =>
    o.label.replace(/USDC — |Custom USDC — /, "");
  const chainInitial = (o: typeof USDC_CHAIN_OPTIONS[number]) => {
    const n = chainName(o);
    return n.startsWith("Base") ? "B" : n.startsWith("Sepolia") ? "S" : n[0]?.toUpperCase() ?? "?";
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
    setForm({ name: "", description: "", billingType: "ONE_TIME", price: "", acceptedToken: connectedToken });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
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
          billingInterval: form.billingType === "RECURRING" ? billingIntervalDays : undefined,
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
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
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
          <button onClick={() => { setOpen(false); resetForm(); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Add-On Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">Create Add-On</p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0" />
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || <span className="font-normal text-muted-foreground">Untitled add-on</span>}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">Add-On Preview</p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">{form.name || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{form.description || "No description"}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <p className="text-sm font-semibold text-foreground">
                      {form.price ? `$${form.price} USDC` : "—"}
                    </p>
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {form.billingType === "ONE_TIME" ? "One-time" : "Recurring"}
                    </span>
                  </div>
                  {form.billingType === "RECURRING" && form.price && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      / {BILLING_INTERVALS.find((i) => i.days === billingIntervalDays)?.label.toLowerCase() ?? `${billingIntervalDays}d`}
                    </p>
                  )}
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">No entitlements yet</p>
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
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Add-On Settings</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Additional features customers can purchase alongside plans.</p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Name */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: "" })); }}
                    placeholder="e.g. Extra Storage, Priority Support"
                    className="h-11 bg-background border-border"
                  />
                  {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                  {autoCode && (
                    <p className="text-xs text-muted-foreground mt-1">Code: <span className="font-mono">{autoCode}</span></p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Describe what this add-on provides"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Optional</p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">Pricing</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">Configure billing for this add-on</p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <span className="font-medium">{form.billingType === "ONE_TIME" ? "One-time" : "Recurring"}</span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem onClick={() => setForm((p) => ({ ...p, billingType: "ONE_TIME" }))}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">One-time</p>
                              <p className="text-xs text-muted-foreground">Single charge purchase</p>
                            </div>
                            {form.billingType === "ONE_TIME" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setForm((p) => ({ ...p, billingType: "RECURRING" }))}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Recurring</p>
                              <p className="text-xs text-muted-foreground">Billed on a schedule</p>
                            </div>
                            {form.billingType === "RECURRING" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Billing Integration</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt ? chainName(selectedChainOpt) : "Select chain"}
                              </span>
                              {selectedChainOpt && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground border border-border"}`}>
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">Connected</span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Testnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "testnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mainnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "mainnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">Switch your wallet network to enable other chains</p>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label className="text-sm font-medium text-foreground mb-2 block">Price (USDC) *</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                          <Input
                            value={form.price}
                            onChange={(e) => { setForm({ ...form, price: e.target.value }); setErrors((p) => ({ ...p, price: "" })); }}
                            placeholder="9.99"
                            type="number"
                            min="0.01"
                            step="0.01"
                            className="h-11 bg-background border-border pl-6"
                          />
                        </div>
                        {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
                      </div>

                      {/* Recurring: billing interval */}
                      {form.billingType === "RECURRING" && (
                        <div>
                          <Label className="text-sm font-medium text-foreground mb-2 block">Billing Interval</Label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                                <span className="font-medium">{BILLING_INTERVALS.find((i) => i.days === billingIntervalDays)?.label ?? `${billingIntervalDays} days`}</span>
                                <ChevronDown className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                              {BILLING_INTERVALS.map((iv) => (
                                <DropdownMenuItem key={iv.days} onClick={() => setBillingIntervalDays(iv.days)} className="flex items-center justify-between">
                                  <div>
                                    <p className="text-sm font-medium">{iv.label}</p>
                                    <p className="text-xs text-muted-foreground">{iv.sublabel}</p>
                                  </div>
                                  {billingIntervalDays === iv.days && <Check className="w-4 h-4 text-foreground ml-2" />}
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
          <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); }} disabled={loading}>
            Cancel
          </Button>
          <Button form="create-addon-form" type="submit" disabled={loading} className="min-w-[140px]">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Save Changes"}
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
  const chainId = useChainId();
  const connectedToken = getUsdcAddress(chainId);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    unitNameSingle: "",
    unitNamePlural: "",
    unitsPerPack: "100",
    price: "",
    acceptedToken: connectedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive code from name
  const autoCode = form.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const selectedChainOpt = USDC_CHAIN_OPTIONS.find((o) => o.address === form.acceptedToken);
  const chainName = (o: typeof USDC_CHAIN_OPTIONS[number]) =>
    o.label.replace(/USDC — |Custom USDC — /, "");
  const chainInitial = (o: typeof USDC_CHAIN_OPTIONS[number]) => {
    const n = chainName(o);
    return n.startsWith("Base") ? "B" : n.startsWith("Sepolia") ? "S" : n[0]?.toUpperCase() ?? "?";
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
    setForm({ name: "", description: "", unitNameSingle: "", unitNamePlural: "", unitsPerPack: "100", price: "", acceptedToken: connectedToken });
    setErrors({});
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const unitName = form.unitNameSingle.trim();
      const res = await fetch("/api/catalog/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: autoCode || "credit",
          unitName,
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
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
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
          <button onClick={() => { setOpen(false); resetForm(); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Credit Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">Create Credit Type</p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0 flex items-center justify-center">
                  <Coins className="w-4 h-4 text-white" />
                </div>
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || <span className="font-normal text-muted-foreground">Untitled credit type</span>}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">Credit Preview</p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">{form.name || "—"}</p>
                  {form.unitNameSingle && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Unit: <span className="font-medium">{form.unitNameSingle}</span>
                      {form.unitNamePlural && ` / ${form.unitNamePlural}`}
                    </p>
                  )}
                  {form.unitsPerPack && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {form.unitsPerPack} {form.unitNameSingle || "units"} per pack
                    </p>
                  )}
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {form.price ? `$${form.price} USDC` : "—"}
                    <span className="text-xs font-normal text-muted-foreground ml-1">/ pack</span>
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
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Credit Type Settings</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {env === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Define a consumable unit for usage-based billing.</p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Credit name */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Credit name *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: "" })); }}
                    placeholder="e.g. API Calls, Storage GB"
                    className="h-11 bg-background border-border"
                  />
                  {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                  {autoCode && (
                    <p className="text-xs text-muted-foreground mt-1">Code: <span className="font-mono">{autoCode}</span></p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional, displayed in components"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Optional, displayed in components</p>
                </div>

                {/* Unit names */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Unit Names</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Single unit name *
                        <span className="text-muted-foreground font-normal ml-1 text-xs">(A single…)</span>
                      </Label>
                      <Input
                        value={form.unitNameSingle}
                        onChange={(e) => { setForm({ ...form, unitNameSingle: e.target.value }); setErrors((p) => ({ ...p, unitNameSingle: "" })); }}
                        placeholder="call, gigabyte, credit"
                        className="h-11 bg-background border-border"
                      />
                      {errors.unitNameSingle && <p className="text-xs text-destructive mt-1">{errors.unitNameSingle}</p>}
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">
                        Multiple unit name
                        <span className="text-muted-foreground font-normal ml-1 text-xs">(Many…)</span>
                      </Label>
                      <Input
                        value={form.unitNamePlural}
                        onChange={(e) => setForm({ ...form, unitNamePlural: e.target.value })}
                        placeholder="calls, gigabytes, credits"
                        className="h-11 bg-background border-border"
                      />
                    </div>
                  </div>
                </div>

                {/* Pack config */}
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-4">Pack Configuration</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Units per pack *</Label>
                      <Input
                        value={form.unitsPerPack}
                        onChange={(e) => { setForm({ ...form, unitsPerPack: e.target.value }); setErrors((p) => ({ ...p, unitsPerPack: "" })); }}
                        placeholder="100"
                        type="number"
                        min="1"
                        className="h-11 bg-background border-border"
                      />
                      {errors.unitsPerPack && <p className="text-xs text-destructive mt-1">{errors.unitsPerPack}</p>}
                      <p className="text-xs text-muted-foreground mt-1.5">How many credits per purchase</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Price (USDC) *</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                        <Input
                          value={form.price}
                          onChange={(e) => { setForm({ ...form, price: e.target.value }); setErrors((p) => ({ ...p, price: "" })); }}
                          placeholder="5.00"
                          type="number"
                          min="0.01"
                          step="0.01"
                          className="h-11 bg-background border-border pl-6"
                        />
                      </div>
                      {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
                    </div>
                  </div>
                </div>

                {/* Billing Integration */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Billing Integration</Label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">
                            {selectedChainOpt ? chainName(selectedChainOpt) : "Select chain"}
                          </span>
                          {selectedChainOpt && (
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground border border-border"}`}>
                              {selectedChainOpt.tag}
                            </span>
                          )}
                          {selectedChainOpt?.chainId === chainId && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">Connected</span>
                          )}
                        </div>
                        <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-80">
                      {USDC_CHAIN_OPTIONS.some((o) => o.tag === "testnet") && (
                        <>
                          <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Testnets</p></div>
                          {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "testnet").map((opt) => {
                            const isConn = opt.chainId === chainId;
                            return (
                              <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                    <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-medium">{chainName(opt)}</p>
                                      {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                    </div>
                                    <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                  </div>
                                </div>
                                {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                              </DropdownMenuItem>
                            );
                          })}
                        </>
                      )}
                      {USDC_CHAIN_OPTIONS.some((o) => o.tag === "mainnet") && (
                        <>
                          <DropdownMenuSeparator />
                          <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mainnets</p></div>
                          {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "mainnet").map((opt) => {
                            const isConn = opt.chainId === chainId;
                            return (
                              <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                    <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <p className="text-sm font-medium">{chainName(opt)}</p>
                                      {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                    </div>
                                    <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                  </div>
                                </div>
                                {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                              </DropdownMenuItem>
                            );
                          })}
                        </>
                      )}
                      <div className="px-3 py-2 border-t border-border mt-1">
                        <p className="text-[10px] text-muted-foreground">Switch your wallet network to enable other chains</p>
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
          <Button type="button" variant="outline" onClick={() => { setOpen(false); resetForm(); }} disabled={loading}>
            Cancel
          </Button>
          <Button form="create-credit-form" type="submit" disabled={loading} className="min-w-[140px]">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Save Changes"}
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
  const chainId = useChainId();

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: credit.name,
    unitNameSingle: credit.unitName,
    unitsPerPack: String(credit.unitsPerPack),
    price: String(parseFloat(credit.price)),
    acceptedToken: credit.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset when credit changes
  useEffect(() => {
    setForm({
      name: credit.name,
      unitNameSingle: credit.unitName,
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
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/catalog/credits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: credit.id,
          name: form.name,
          unitName: form.unitNameSingle,
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

  const selectedChainOpt = USDC_CHAIN_OPTIONS.find((o) => o.address === form.acceptedToken);
  const chainName = (o: typeof USDC_CHAIN_OPTIONS[number]) =>
    o.label.replace(/USDC — |Custom USDC — /, "");
  const chainInitial = (o: typeof USDC_CHAIN_OPTIONS[number]) => {
    const n = chainName(o);
    return n.startsWith("Base") ? "B" : n.startsWith("Sepolia") ? "S" : n[0]?.toUpperCase() ?? "?";
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
          <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <form id="edit-credit-form" onSubmit={handleSubmit} className="p-6 space-y-6">
            {errors._global && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive">{errors._global}</p>
              </div>
            )}

            <div>
              <Label className="text-sm font-medium mb-2 block">Credit name *</Label>
              <Input
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setErrors((p) => ({ ...p, name: "" })); }}
                className="h-11 bg-background border-border"
              />
              {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">Unit name (singular) *</Label>
              <Input
                value={form.unitNameSingle}
                onChange={(e) => { setForm({ ...form, unitNameSingle: e.target.value }); setErrors((p) => ({ ...p, unitNameSingle: "" })); }}
                placeholder="e.g. credit, call, token"
                className="h-11 bg-background border-border"
              />
              {errors.unitNameSingle && <p className="text-xs text-destructive mt-1">{errors.unitNameSingle}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium mb-2 block">Units per pack *</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.unitsPerPack}
                  onChange={(e) => { setForm({ ...form, unitsPerPack: e.target.value }); setErrors((p) => ({ ...p, unitsPerPack: "" })); }}
                  className="h-11 bg-background border-border"
                />
                {errors.unitsPerPack && <p className="text-xs text-destructive mt-1">{errors.unitsPerPack}</p>}
              </div>
              <div>
                <Label className="text-sm font-medium mb-2 block">Price (USDC) *</Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => { setForm({ ...form, price: e.target.value }); setErrors((p) => ({ ...p, price: "" })); }}
                  placeholder="0.00"
                  className="h-11 bg-background border-border"
                />
                {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
              </div>
            </div>

            {/* Chain / Billing Integration */}
            <div>
              <Label className="text-sm font-medium mb-2 block">Billing Integration</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="flex items-center justify-between w-full h-11 px-3 rounded-lg bg-background border border-border text-sm hover:border-ring/50 transition-colors">
                    {selectedChainOpt ? (
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center text-[10px] font-bold">
                          {chainInitial(selectedChainOpt)}
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-medium leading-none">{chainName(selectedChainOpt)}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">USDC · {selectedChainOpt.address.slice(0, 6)}…{selectedChainOpt.address.slice(-4)}</p>
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Select chain</span>
                    )}
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="start">
                  {USDC_CHAIN_OPTIONS.map((opt) => {
                    const isConn = opt.chainId === chainId;
                    return (
                      <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((p) => ({ ...p, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                            <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium">{chainName(opt)}</p>
                            <p className="text-xs font-mono text-muted-foreground">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                          </div>
                        </div>
                        {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 shrink-0" />}
                        {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </form>
        </div>

        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button form="edit-credit-form" type="submit" disabled={loading} className="min-w-[120px]">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
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
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { signTypedDataAsync } = useSignTypedData();

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
      }
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter]);

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
    // Check wallet connection
    if (!isConnected || !address) {
      toast.error("Connect your wallet to continue");
      return;
    }

    // Free plans (price = 0) cannot be registered — PlanFactory requires price > 0
    if (parseFloat(plan.price) === 0) {
      toast.error("Free plans don't need on-chain registration.", { duration: 4000 });
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
      const {
        nonce,
        planFactoryAddress,
        domain,
        signingRequired,
        providerAddress,
      } = (await nonceRes.json()) as {
        nonce: string;
        planFactoryAddress: string;
        domain: {
          name: string;
          version: string;
          chainId: number;
          verifyingContract: string;
        };
        signingRequired: boolean;
        providerAddress?: string;
      };

      if (signingRequired) {
        // Verify the connected wallet matches the stored provider wallet
        try {
          const walletRes = await fetch("/api/auth/wallet-status");
          if (walletRes.ok) {
            const { storedWallet } = await walletRes.json();
            if (
              storedWallet &&
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
      const priceInUsdc = BigInt(
        Math.round(parseFloat(plan.price) * 1_000_000),
      );
      const billingIntervalSeconds = plan.billingInterval * 86400;

      // 3. Sign EIP-712 typed data when the provider is the connected wallet
      const signature = signingRequired
        ? await signTypedDataAsync({
            domain: {
              name: domain.name,
              version: domain.version,
              chainId: BigInt(domain.chainId),
              verifyingContract: planFactoryAddress as `0x${string}`,
            },
            types: {
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
            primaryType: "CreatePlan",
            message: {
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
      toast.success(`Registered on-chain · ${(data.txHash ?? "").slice(0, 10)}…`);
      load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      // Handle user rejection
      if (
        msg.includes("rejected") ||
        msg.includes("denied") ||
        msg.includes("User rejected")
      ) {
        toast.error("Signature cancelled");
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

  const envLabel = env === "DEVELOPMENT" ? "Testnet" : "Mainnet";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {envLabel}
          </Badge>
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
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-4">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/15 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-card">
            <Package className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-base font-semibold text-foreground">
            No plans in {envLabel} yet
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first catalog plan to start selling in the active
            environment.
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
              <TableHead>Chain</TableHead>
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
                    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("[role='menuitem']")) return;
                    onSelect?.(plan);
                  }}
                >
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {plan.tier}
                  </TableCell>
                  <TableCell>
                    {isFree ? (
                      <span className="text-sm font-medium text-foreground">Free</span>
                    ) : (
                      <div>
                        <span className="text-sm">${parseFloat(plan.price).toFixed(2)} USDC</span>
                        {plan.annualPrice && parseFloat(plan.annualPrice) > 0 && (
                          <span className="block text-[10px] text-muted-foreground">
                            ${parseFloat(plan.annualPrice).toFixed(2)}/yr
                            {parseFloat(plan.price) > 0 && (
                              <span className="ml-1 text-green-500">
                                · {Math.round((1 - parseFloat(plan.annualPrice) / (parseFloat(plan.price) * 12)) * 100)}% off
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {BILLING_INTERVALS.find((i) => i.days === plan.billingInterval)?.label ?? `${plan.billingInterval}d`}
                  </TableCell>
                  <TableCell className="text-xs">
                    {isFree ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      tokenLabel(plan.acceptedToken)
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
                    ) : plan.chainSyncStatus && plan.chainSyncStatus !== "NOT_APPLICABLE" ? (
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
                              ? "Registering…"
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
      }
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter]);

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
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading add-ons...</p>
          </div>
        </div>
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
                    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("[role='menuitem']")) return;
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
  const [creditTypes, setCreditTypes] = useState<CatalogCreditType[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ environmentMode: env });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/catalog/credits?${params}`);
      if (res.ok) {
        const data = await res.json();
        setCreditTypes(data.creditTypes ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [env, statusFilter]);

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
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading credit types...
            </p>
          </div>
        </div>
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
                    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("[role='menuitem']")) return;
                    onSelect?.(ct);
                  }}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-linear-to-br from-amber-500/20 to-orange-400/10 border border-border flex items-center justify-center">
                        <Coins className="w-4 h-4 text-amber-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{ct.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{ct.code}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{ct.unitName}</TableCell>
                  <TableCell className="text-sm">{ct.unitsPerPack}</TableCell>
                  <TableCell className="text-sm font-medium">${parseFloat(ct.price).toFixed(2)}</TableCell>
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
                          {updating === ct.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
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

const CHAIN_INFO: Record<
  EnvMode,
  { chainId: number; name: string; color: string; tag: string }
> = {
  DEVELOPMENT: {
    chainId: DEFAULT_TESTNET_CHAIN_ID,
    name: "Base Sepolia Testnet",
    color: "bg-zinc-400",
    tag: "testnet",
  },
  PRODUCTION: {
    chainId: DEFAULT_TESTNET_CHAIN_ID,
    name: "Base Sepolia Testnet",
    color: "bg-zinc-400",
    tag: "testnet",
  },
};

type CatalogConfigSettings = {
  initialPlan: string;
  fallbackPlan: string;
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

function ConfigurationTab() {
  const { envMode, setEnvMode } = useEnvironment();
  const chainId = useChainId();
  const { isConnected, address } = useAccount();

  const [switchTarget, setSwitchTarget] = useState<EnvMode>("DEVELOPMENT");
  const [confirmText, setConfirmText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [settings, setSettings] = useState<CatalogConfigSettings>(DEFAULT_CONFIG_SETTINGS);

  // Load catalog plans for dropdowns
  const [catalogPlans, setCatalogPlans] = useState<{ id: string; name: string; tier: string; price: string }[]>([]);
  useEffect(() => {
    fetch(`/api/catalog/plans?environmentMode=${envMode}&limit=50`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.plans) setCatalogPlans(d.plans); })
      .catch(() => {});
  }, [envMode]);

  useEffect(() => {
    let cancelled = false;
    setLoadingConfig(true);
    setConfigError(null);
    fetch(`/api/catalog/config?environmentMode=${envMode}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const config = (data.config ?? {}) as Partial<CatalogConfigSettings> & { fallbackPlan?: string | null };
        setSettings({ ...DEFAULT_CONFIG_SETTINGS, ...config, fallbackPlan: config.fallbackPlan || "none" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setConfigError(err instanceof Error ? err.message : "Failed to load configuration");
      })
      .finally(() => { if (!cancelled) setLoadingConfig(false); });
    return () => { cancelled = true; };
  }, [envMode]);

  useEffect(() => {
    if (catalogPlans.length === 0) return;

    const resolvePlanId = (value: string) => {
      if (!value || value === "none") return value;
      const match = catalogPlans.find(
        (plan) => plan.id === value || plan.tier === value || plan.name === value,
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
          fallbackPlan: settings.fallbackPlan === "none" ? null : settings.fallbackPlan,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success("Configuration saved for Base Sepolia");
    } catch (err: unknown) {
      setConfigError(err instanceof Error ? err.message : "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSwitch(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== "CONFIRM") return;
    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/environment/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentMode: switchTarget, confirmText: "CONFIRM" }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnvMode(data.environmentMode as EnvMode);
        setDialogOpen(false);
        setConfirmText("");
        toast.success(`Switched to ${data.environmentMode} — Chain ${data.chainId}`);
      } else {
        setSwitchError(data.error || "Switch failed");
      }
    } finally {
      setSwitching(false);
    }
  }

  const currentChainInfo = CHAIN_INFO[envMode];
  const walletChainMatch = chainId === currentChainInfo.chainId;
  const usdcAddress = getUsdcAddress(currentChainInfo.chainId);

  // ToggleRow helper
  function ToggleRow({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
      <div className="flex items-start justify-between gap-6 p-5 hover:bg-secondary/10 transition-colors">
        <div className="space-y-1 flex-1">
          <Label htmlFor={id} className="text-sm font-semibold text-foreground cursor-pointer">{label}</Label>
          <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
        </div>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* Active environment status bar */}
      <div className="rounded-xl border border-border bg-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-zinc-400" />
          <div>
            <p className="text-sm font-bold text-foreground leading-tight">
              Base Sepolia Environment
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {currentChainInfo.name} · Chain {currentChainInfo.chainId}
            </p>
          </div>
          <span className="text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {currentChainInfo.tag}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {isConnected ? (
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${walletChainMatch ? "bg-green-500" : "bg-orange-500"}`} />
              <p className="text-xs text-muted-foreground">
                {walletChainMatch ? "Wallet on correct chain" : "Wallet on wrong chain"}
                {address && <span className="ml-1 font-mono">{address.slice(0, 6)}…{address.slice(-4)}</span>}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Wallet not connected</p>
          )}
        </div>
      </div>

      {configError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {configError}
        </div>
      )}

      {/* ── Default Plans ─────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20">
          <h3 className="text-sm font-bold text-foreground">Default Plans</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Plans automatically assigned to new subscribers on sign-up.
          </p>
        </div>
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="initial-plan" className="text-sm font-semibold text-foreground">Initial Plan</Label>
              <Select value={settings.initialPlan} onValueChange={(v) => setSettings({ ...settings, initialPlan: v })}>
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
              <p className="text-xs text-muted-foreground">Assigned when a wallet first connects.</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fallback-plan" className="text-sm font-semibold text-foreground">Fallback Plan</Label>
              <Select value={settings.fallbackPlan} onValueChange={(v) => setSettings({ ...settings, fallbackPlan: v })}>
                <SelectTrigger id="fallback-plan" className="h-11 bg-background border-border">
                  <SelectValue placeholder="No fallback" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {catalogPlans.filter((p) => parseFloat(p.price) === 0).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} (Free)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Assigned if a subscription lapses or is cancelled.</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Component Display ───────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20">
          <h3 className="text-sm font-bold text-foreground">Component Display</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Control what your end-users see in embedded billing components.
          </p>
        </div>
        <div className="divide-y divide-border/50">
          <ToggleRow
            id="free-price" label='Show "Free" instead of "$0.00"'
            desc="Display the word Free in the portal and checkout instead of a zero price"
            checked={settings.freePlanPriceDisplay}
            onChange={(v) => setSettings({ ...settings, freePlanPriceDisplay: v })}
          />
          <ToggleRow
            id="hide-credits" label="Hide credit balances"
            desc="Obscure credit balance and USDC consumption from checkout and portal components"
            checked={settings.hideCredits}
            onChange={(v) => setSettings({ ...settings, hideCredits: v })}
          />
          <ToggleRow
            id="feature-desc" label="Show feature descriptions"
            desc="Display entitlement descriptions inside checkout and portal plan cards"
            checked={settings.showFeatureDescriptions}
            onChange={(v) => setSettings({ ...settings, showFeatureDescriptions: v })}
          />
          <ToggleRow
            id="hard-limits" label="Show hard limits"
            desc="Surface defined hard limits (e.g. max API calls) for metered entitlements"
            checked={settings.showHardLimits}
            onChange={(v) => setSettings({ ...settings, showHardLimits: v })}
          />
        </div>
      </div>

      {/* ── Plan Change Rules ───────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20">
          <h3 className="text-sm font-bold text-foreground">Plan Change Rules</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            On-chain rules applied when subscribers upgrade or downgrade their plan.
          </p>
        </div>
        <div className="p-5 space-y-4">
          {/* Upgrade */}
          <div className="rounded-lg border border-border bg-secondary/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-secondary/10">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider">On Upgrade</p>
              <p className="text-xs text-muted-foreground ml-1">→ higher cost plan or adding an add-on</p>
            </div>
            <ToggleRow
              id="upgrade-immediate" label="Charge the difference immediately on-chain"
              desc="Apply the upgrade and collect the prorated USDC difference in the same transaction"
              checked={settings.upgradeImmediately}
              onChange={(v) => setSettings({ ...settings, upgradeImmediately: v })}
            />
          </div>
          {/* Downgrade */}
          <div className="rounded-lg border border-border bg-secondary/5 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50 bg-secondary/10">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <p className="text-xs font-bold text-foreground uppercase tracking-wider">On Downgrade</p>
              <p className="text-xs text-muted-foreground ml-1">→ lower cost plan or removing an add-on</p>
            </div>
            <div className="divide-y divide-border/50">
              <ToggleRow
                id="downgrade-immediate" label="Apply downgrade immediately and credit wallet"
                desc="Downgrade takes effect now and the prorated USDC difference is credited back to the subscriber's wallet"
                checked={settings.downgradeImmediately}
                onChange={(v) => setSettings({ ...settings, downgradeImmediately: v })}
              />
              <ToggleRow
                id="prevent-downgrade" label="Block downgrade when subscriber is over the limit"
                desc="Reject a downgrade transaction if the subscriber is using more than the destination plan allows"
                checked={settings.preventDowngradeOverLimit}
                onChange={(v) => setSettings({ ...settings, preventDowngradeOverLimit: v })}
              />
              <ToggleRow
                id="disallow-self-downgrade" label="Require admin approval for downgrades"
                desc="End-users cannot self-service downgrade — an admin must trigger the on-chain downgrade"
                checked={settings.disallowSelfServiceDowngrade}
                onChange={(v) => setSettings({ ...settings, disallowSelfServiceDowngrade: v })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Network & Contracts ─────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20">
          <h3 className="text-sm font-bold text-foreground">Network & Contracts</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Blockchain network mapping and deployed contract addresses.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/5">
                <th className="text-left py-3 px-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Environment</th>
                <th className="text-left py-3 px-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Network</th>
                <th className="text-left py-3 px-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Chain ID</th>
                <th className="text-left py-3 px-5 text-xs font-bold uppercase tracking-wider text-muted-foreground">USDC Contract</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {(Object.entries(CHAIN_INFO) as [EnvMode, typeof CHAIN_INFO[EnvMode]][]).map(([mode, info]) => {
                const usdc = getUsdcAddress(info.chainId);
                const isActive = mode === envMode;
                return (
                  <tr key={mode} className={`transition-colors ${isActive ? "bg-secondary/10" : "hover:bg-secondary/5"}`}>
                    <td className="py-3.5 px-5">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${info.color}`} />
                        <span className="font-semibold text-foreground">{mode === "DEVELOPMENT" ? "Development" : "Production"}</span>
                        {isActive && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Active</span>}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 text-muted-foreground">{info.name}</td>
                    <td className="py-3.5 px-5 font-mono text-muted-foreground">{info.chainId}</td>
                    <td className="py-3.5 px-5 font-mono text-xs text-muted-foreground">
                      {usdc.slice(0, 10)}…{usdc.slice(-6)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Current USDC address */}
        <div className="px-5 py-3 border-t border-border/50 bg-secondary/5 flex items-center gap-2">
          <Coins className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <p className="text-xs text-muted-foreground">
            Active USDC ({currentChainInfo.name}):{" "}
            <span className="font-mono text-foreground">{usdcAddress}</span>
          </p>
        </div>
      </div>

      {/* ── Switch Environment ─────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-secondary/20">
          <h3 className="text-sm font-bold text-foreground">Switch Environment</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Switches which blockchain network the catalog is published to. Production requires deployed contracts on Base Mainnet.
          </p>
        </div>
        <div className="p-5">
          <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
            <SheetTrigger asChild>
              <Button size="default" variant="outline" className="gap-2 h-10 hover:bg-secondary transition-colors">
                <SlidersHorizontal className="w-4 h-4" />
                Switch Environment
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle>Switch Environment</SheetTitle>
                <SheetDescription>
                  Base Sepolia is the only supported dashboard network right now.
                </SheetDescription>
              </SheetHeader>
              <form onSubmit={handleSwitch} className="space-y-5 py-5">
                {/* Target selector */}
                <div className="grid grid-cols-1 gap-3">
                  {(["DEVELOPMENT"] as EnvMode[]).map((mode) => {
                    const info = CHAIN_INFO[mode];
                    const isSelected = switchTarget === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSwitchTarget(mode)}
                        className={`flex flex-col items-start gap-2 p-4 rounded-xl border text-left transition-all ${isSelected ? "border-foreground bg-secondary" : "border-border hover:bg-secondary/50"}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${info.color}`} />
                          <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                            Development
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">{info.name}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">Chain {info.chainId}</p>
                        {isSelected && <Check className="w-4 h-4 text-foreground ml-auto mt-1" />}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-text" className="text-sm font-semibold">
                    Type <span className="font-mono bg-secondary px-1.5 py-0.5 rounded text-foreground">CONFIRM</span> to proceed
                  </Label>
                  <Input
                    id="confirm-text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="CONFIRM"
                    className="bg-background border-border font-mono h-11"
                    autoComplete="off"
                  />
                </div>

                {switchError && (
                  <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-destructive" />
                    <span className="text-sm text-destructive">{switchError}</span>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                  <Button type="button" variant="outline" onClick={() => { setDialogOpen(false); setConfirmText(""); setSwitchError(null); }}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={confirmText !== "CONFIRM" || switching} className="min-w-28">
                    {switching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Switching…</> : "Switch"}
                  </Button>
                </div>
              </form>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-0 -mx-1 px-1 pb-4 pt-2 bg-gradient-to-t from-background to-transparent">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <p className="text-xs text-muted-foreground">
            {loadingConfig ? "Loading configuration…" : "Changes saved per environment"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSettings(DEFAULT_CONFIG_SETTINGS)} disabled={loadingConfig || savingConfig}>
              Reset
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loadingConfig || savingConfig} className="gap-2 min-w-[120px]">
              {savingConfig ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Saving…</> : "Save changes"}
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
          <CreateAddOnDialog env={envMode} onCreated={tr} />
        </div>
      </div>
      <AddOnsTable env={envMode} refresh={refresh} onSelect={setSelectedAddOn} />
    </div>
  );
}

export function CatalogCreditsSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  const [selectedCredit, setSelectedCredit] = useState<CatalogCreditType | null>(null);

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
          <CreateCreditTypeDialog env={envMode} onCreated={tr} />
        </div>
      </div>
      <CreditTypesTable env={envMode} refresh={refresh} onSelect={setSelectedCredit} />
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
            Manage environment settings and blockchain network configuration
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
}

// ─── Add Entitlement Dialog ────────────────────────────────────────────────────

type CatalogFeatureDef = {
  id: string;
  name: string;
  featureKey: string;
  featureType: "boolean" | "event" | "trait";
  eventKey: string | null;
  description: string | null;
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
  const [catalogFeatures, setCatalogFeatures] = useState<CatalogFeatureDef[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(false);
  const [selectedFeature, setSelectedFeature] = useState<CatalogFeatureDef | null>(null);
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
  useEffect(() => {
    if (!open) return;
    setFeaturesLoading(true);
    fetch("/api/v1/features")
      .then((r) => r.ok ? r.json() : { features: [] })
      .then((d: { features?: CatalogFeatureDef[] }) => setCatalogFeatures(d.features ?? []))
      .catch(() => setCatalogFeatures([]))
      .finally(() => setFeaturesLoading(false));
  }, [open]);

  function selectFeature(feat: CatalogFeatureDef) {
    setSelectedFeature(feat);
    const type: "BOOLEAN" | "NUMERIC" | "UNLIMITED" =
      feat.featureType === "event" ? "NUMERIC" : "BOOLEAN";
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

  function clearFeature() {
    setSelectedFeature(null);
    setForm({ featureName: "", featureKey: "", type: "BOOLEAN", value: "", valueUnit: "", enabled: true });
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
      if (form.value === "" || isNaN(n) || n < 0) e.value = "Enter a valid limit";
    }
    if (Object.keys(e).length) { setErrors(e); return; }

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
  const planPrice = isFree ? "Free" : `$${parseFloat(plan.price).toFixed(2)}/month`;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) clearFeature(); setOpen(v); }}>
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
            <SheetTitle className="text-lg font-semibold">{plan.name}</SheetTitle>
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
              <div className="h-11 bg-secondary rounded-lg animate-pulse" />
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
                      <p className="text-sm text-muted-foreground">No features yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Go to <strong>Manage → Features</strong> to create features first
                      </p>
                    </div>
                  ) : (
                    catalogFeatures.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          <div className="w-5 h-5 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                            {f.featureType === "event" ? (
                              <Hash className="w-3 h-3 text-violet-500" />
                            ) : (
                              <ToggleLeft className="w-3 h-3 text-blue-500" />
                            )}
                          </div>
                          <span className="font-medium">{f.name}</span>
                          <code className="text-xs text-muted-foreground font-mono">{f.featureKey}</code>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            )}
            {errors._global && <p className="text-sm text-destructive">{errors._global}</p>}
          </div>

          {/* ── Monetization Settings (shown once feature selected) ── */}
          {!selectedFeature ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-border bg-secondary/20">
              <ToggleLeft className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Select a feature to configure entitlement</p>
            </div>
          ) : (
            <>
              {/* Feature info pill */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
                <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
                  {selectedFeature.featureType === "event" ? (
                    <Hash className="w-4 h-4 text-violet-500" />
                  ) : (
                    <ToggleLeft className="w-4 h-4 text-blue-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{selectedFeature.name}</p>
                  <code className="text-xs text-muted-foreground font-mono">{selectedFeature.featureKey}</code>
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
                  {(["BOOLEAN", "NUMERIC", "UNLIMITED"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, type: t, value: "" }))}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-sm transition-all text-left ${
                        form.type === t
                          ? "bg-accent/5 border-accent text-foreground"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${form.type === t ? "bg-accent/10" : "bg-card border border-border"}`}>
                        {t === "BOOLEAN" ? (
                          <ToggleLeft className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`} />
                        ) : t === "NUMERIC" ? (
                          <Hash className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`} />
                        ) : (
                          <Package className={`w-4 h-4 ${form.type === t ? "text-accent" : "text-muted-foreground"}`} />
                        )}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium leading-none">
                          {t === "BOOLEAN" ? "Boolean" : t === "NUMERIC" ? "Numeric limit" : "Unlimited"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t === "BOOLEAN" ? "On / Off access" : t === "NUMERIC" ? "Usage cap per billing period" : "No cap enforced"}
                        </p>
                      </div>
                      {form.type === t && <Check className="w-4 h-4 text-accent shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* NUMERIC fields */}
              {form.type === "NUMERIC" && (
                <div className="space-y-3 p-4 rounded-lg bg-secondary/30 border border-border">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Monthly limit *</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.value}
                      onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                      placeholder="e.g. 300"
                      className="bg-background border-border"
                    />
                    {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Unit label</Label>
                    <Input
                      value={form.valueUnit}
                      onChange={(e) => setForm((f) => ({ ...f, valueUnit: e.target.value }))}
                      placeholder="e.g. Scans, API calls"
                      className="bg-background border-border"
                    />
                    {form.value && (
                      <p className="text-xs text-muted-foreground">
                        Displays as: <strong>{form.value} {form.valueUnit || "units"} per month</strong>
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
                    <p className="text-xs text-muted-foreground mt-0.5">Feature is on for all subscribers of this plan</p>
                  </div>
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                  />
                </div>
              )}

              {/* Plan preview */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan Preview</Label>
                <div className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-foreground">{plan.name}</p>
                      {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                    </div>
                    <p className="text-base font-bold text-foreground whitespace-nowrap">
                      {isFree ? "Free" : `$${parseFloat(plan.price).toFixed(2)}/mo`}
                    </p>
                  </div>
                  <div className="space-y-1.5 pt-3 border-t border-border">
                    {(currentEntitlements ?? []).map((ent) => (
                      <div key={ent.featureKey} className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                          {ent.type === "NUMERIC" ? <Hash className="w-2.5 h-2.5 text-violet-500" /> : <ToggleLeft className="w-2.5 h-2.5 text-blue-500" />}
                        </div>
                        <p className="text-xs text-foreground">{ent.featureName}</p>
                        <p className="text-xs text-muted-foreground ml-auto">
                          {ent.type === "NUMERIC" ? `${ent.value} ${ent.valueUnit ?? ""} /mo` : ent.enabled ? "On" : "Off"}
                        </p>
                      </div>
                    ))}
                    {/* New entitlement preview */}
                    <div className="flex items-center gap-2 pt-1 border-t border-dashed border-border/50">
                      <div className="w-5 h-5 rounded bg-accent/10 border border-accent/30 flex items-center justify-center shrink-0">
                        {form.type === "NUMERIC" ? <Hash className="w-2.5 h-2.5 text-violet-500" /> : <ToggleLeft className="w-2.5 h-2.5 text-blue-500" />}
                      </div>
                      <p className="text-xs font-medium text-foreground">{selectedFeature.name}</p>
                      <p className="text-xs text-muted-foreground ml-auto">
                        {form.type === "NUMERIC" && form.value ? `${form.value} ${form.valueUnit || ""} /mo` : form.type === "UNLIMITED" ? "Unlimited" : form.enabled ? "On" : "Off"}
                      </p>
                      <span className="text-xs text-accent font-semibold">New</span>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-card shrink-0 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!selectedFeature || loading} onClick={handleSave}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save changes"}
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
  const chainId = useChainId();
  const connectedToken = getUsdcAddress(chainId);

  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);

  // Determine initial plan type from price
  const initPlanType: "free" | "paid" = parseFloat(plan.price) === 0 ? "free" : "paid";
  const [planType, setPlanType] = useState<"free" | "paid">(initPlanType);

  // Find matching interval or keep raw value
  const initIntervalDays = plan.billingInterval;
  const matchedInterval = BILLING_INTERVALS.find((i) => i.days === initIntervalDays);
  const [billingIntervalDays, setBillingIntervalDays] = useState(initIntervalDays);

  const [form, setForm] = useState({
    name: plan.name,
    tier: plan.tier,
    description: plan.description ?? "",
    price: parseFloat(plan.price).toFixed(2),
    acceptedToken: plan.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Auto-derive tier from name
  const autoTier = form.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const selectedChainOpt = USDC_CHAIN_OPTIONS.find((o) => o.address === form.acceptedToken);
  const chainName = (o: typeof USDC_CHAIN_OPTIONS[number]) =>
    o.label.replace(/USDC — |Custom USDC — /, "");
  const chainInitial = (o: typeof USDC_CHAIN_OPTIONS[number]) => {
    const n = chainName(o);
    return n.startsWith("Base") ? "B" : n.startsWith("Sepolia") ? "S" : n[0]?.toUpperCase() ?? "?";
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Required";
    if (planType === "paid") {
      if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0)
        errs.price = "Must be positive";
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
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
          billingInterval: billingIntervalDays,
          acceptedToken: form.acceptedToken,
        }),
      });
      if (res.ok) {
        setOpen(false);
        toast.success("Plan updated");
        onSaved();
      } else {
        const data = await res.json();
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
          <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* ── LEFT: Plan Preview ── */}
          <div className="w-[300px] shrink-0 border-r border-border bg-secondary/20 p-6 flex flex-col gap-6 overflow-y-auto">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-4">Edit Plan</p>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-full bg-linear-to-br from-zinc-400 to-zinc-700 shrink-0 flex items-center justify-center text-white font-bold text-sm">
                  {form.name.charAt(0).toUpperCase() || "?"}
                </div>
                <p className="text-base font-bold text-foreground truncate">
                  {form.name || <span className="font-normal text-muted-foreground">Untitled plan</span>}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">Plan Preview</p>
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="p-4 border-b border-border">
                  <p className="text-lg font-bold text-foreground leading-tight">{form.name || "—"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{form.description || form.name || "—"}</p>
                  <p className="text-sm font-semibold text-foreground mt-1.5">
                    {planType === "free" ? "Free" : form.price ? `$${form.price} USDC` : "—"}
                    {planType === "paid" && form.price && (
                      <span className="text-xs font-normal text-muted-foreground ml-1">
                        / {matchedInterval?.label.toLowerCase() ?? `${billingIntervalDays}d`}
                      </span>
                    )}
                  </p>
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground text-center py-3">No entitlements yet</p>
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
                    <h2 className="text-2xl font-bold text-foreground tracking-tight">Plan Settings</h2>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                      {plan.environmentMode === "DEVELOPMENT" ? "Dev" : "Production"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">Update this plan's settings.</p>
                </div>

                {errors._global && (
                  <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                    <p className="text-sm text-destructive">{errors._global}</p>
                  </div>
                )}

                {/* Name + Tier */}
                <div className="grid grid-cols-[1fr_auto] gap-4 items-start">
                  <div>
                    <Label className="text-sm font-medium text-foreground mb-2 block">Name *</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors((p) => ({ ...p, name: "" })); }}
                      placeholder="e.g. Pro, Starter, Enterprise"
                      className="h-11 bg-background border-border"
                    />
                    {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
                  </div>
                  <div className="w-28">
                    <Label className="text-sm font-medium text-foreground mb-2 block">
                      Tier
                      <span className="text-muted-foreground font-normal ml-1">(auto)</span>
                    </Label>
                    <Input
                      value={form.tier || autoTier}
                      onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
                      placeholder={autoTier || plan.tier}
                      className="h-11 bg-background border-border font-mono text-sm"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <Label className="text-sm font-medium text-foreground mb-2 block">Description</Label>
                  <Input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Describe this plan"
                    className="h-11 bg-background border-border"
                  />
                  <p className="text-xs text-muted-foreground mt-1.5">Optional</p>
                </div>

                {/* Pricing */}
                <div>
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">Pricing</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-5">Update pricing and billing settings</p>

                  <div className="grid grid-cols-2 gap-4">
                    {/* Type */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Type</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <span className="font-medium">{planType === "free" ? "Free" : "Paid"}</span>
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                          <DropdownMenuItem onClick={() => { setPlanType("free"); setForm((f) => ({ ...f, price: "0" })); }}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Free</p>
                              <p className="text-xs text-muted-foreground">No charge — $0.00 USDC</p>
                            </div>
                            {planType === "free" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPlanType("paid")}>
                            <div className="flex-1">
                              <p className="text-sm font-medium">Paid</p>
                              <p className="text-xs text-muted-foreground">Recurring USDC payment</p>
                            </div>
                            {planType === "paid" && <Check className="w-4 h-4 ml-2 text-foreground" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Billing Integration */}
                    <div>
                      <Label className="text-sm font-medium text-foreground mb-2 block">Billing Integration</Label>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium truncate">
                                {selectedChainOpt ? chainName(selectedChainOpt) : "Select chain"}
                              </span>
                              {selectedChainOpt && (
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${selectedChainOpt.tag === "mainnet" ? "bg-success/10 text-success" : "bg-secondary text-muted-foreground border border-border"}`}>
                                  {selectedChainOpt.tag}
                                </span>
                              )}
                              {selectedChainOpt?.chainId === chainId && (
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background shrink-0">Connected</span>
                              )}
                            </div>
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-1" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="w-80">
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "testnet") && (
                            <>
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Testnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "testnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((f) => ({ ...f, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          {USDC_CHAIN_OPTIONS.some((o) => o.tag === "mainnet") && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 pt-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Mainnets</p></div>
                              {USDC_CHAIN_OPTIONS.filter((o) => o.tag === "mainnet").map((opt) => {
                                const isConn = opt.chainId === chainId;
                                return (
                                  <DropdownMenuItem key={opt.chainId} disabled={!isConn} onClick={() => isConn && setForm((f) => ({ ...f, acceptedToken: opt.address }))} className={`flex items-center justify-between gap-3 py-2.5 ${!isConn ? "opacity-40 cursor-not-allowed" : ""}`}>
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${isConn ? "bg-foreground text-background border-foreground" : "bg-secondary text-muted-foreground border-border"}`}>
                                        <span className="text-[10px] font-bold">{chainInitial(opt)}</span>
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-1.5">
                                          <p className="text-sm font-medium">{chainName(opt)}</p>
                                          {isConn && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground text-background">Connected</span>}
                                        </div>
                                        <p className="text-xs font-mono text-muted-foreground mt-0.5">USDC · {opt.address.slice(0, 6)}…{opt.address.slice(-4)}</p>
                                      </div>
                                    </div>
                                    {form.acceptedToken === opt.address && isConn && <Check className="w-3.5 h-3.5 text-foreground shrink-0" />}
                                    {!isConn && <span className="text-[9px] text-muted-foreground shrink-0">Switch wallet</span>}
                                  </DropdownMenuItem>
                                );
                              })}
                            </>
                          )}
                          <div className="px-3 py-2 border-t border-border mt-1">
                            <p className="text-[10px] text-muted-foreground">Switch your wallet network to enable other chains</p>
                          </div>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  {/* Paid-only: Price + Interval */}
                  {planType === "paid" && (
                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <Label className="text-sm font-medium text-foreground mb-2 block">Price (USDC) *</Label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">$</span>
                          <Input
                            value={form.price}
                            onChange={(e) => { setForm((f) => ({ ...f, price: e.target.value })); setErrors((p) => ({ ...p, price: "" })); }}
                            placeholder="29.00"
                            type="number"
                            min="0.01"
                            step="0.01"
                            className="h-11 bg-background border-border pl-6"
                          />
                        </div>
                        {errors.price && <p className="text-xs text-destructive mt-1">{errors.price}</p>}
                      </div>
                      <div>
                        <Label className="text-sm font-medium text-foreground mb-2 block">Billing Interval</Label>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button type="button" className="w-full flex items-center justify-between h-11 px-3 rounded-lg bg-background border border-border text-sm text-foreground hover:bg-secondary/50 transition-colors">
                              <span className="font-medium">{BILLING_INTERVALS.find((i) => i.days === billingIntervalDays)?.label ?? `${billingIntervalDays} days`}</span>
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width]">
                            {BILLING_INTERVALS.map((iv) => (
                              <DropdownMenuItem key={iv.days} onClick={() => setBillingIntervalDays(iv.days)} className="flex items-center justify-between">
                                <div>
                                  <p className="text-sm font-medium">{iv.label}</p>
                                  <p className="text-xs text-muted-foreground">{iv.sublabel}</p>
                                </div>
                                {billingIntervalDays === iv.days && <Check className="w-4 h-4 text-foreground ml-2" />}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border px-6 py-4 flex items-center justify-end gap-3 bg-background">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button form="edit-plan-form" type="submit" disabled={loading} className="min-w-[140px]">
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save Changes"}
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

function planPriceLabel(plan: CatalogPlan): string {
  const price = parseFloat(plan.price);
  if (price === 0) return "Free";
  const intervalLabel =
    plan.billingInterval <= 30
      ? "mo"
      : plan.billingInterval <= 92
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
      .then((r) => r.ok ? r.json() : { creditTypes: [] })
      .then((d: { creditTypes?: CatalogCreditType[] }) => setCreditTypes(d.creditTypes ?? []))
      .catch(() => setCreditTypes([]))
      .finally(() => setCreditsLoading(false));
  }, [open, envMode]);

  const availableTypes = creditTypes.filter((ct) => !existingIds.includes(ct.id));
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
    <Sheet open={open} onOpenChange={(v) => { if (!v) { setSelectedId(""); setAmount("50"); } setOpen(v); }}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-medium">
          <Plus className="w-3.5 h-3.5" />
          Add credit grant
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0 gap-0">
        <SheetHeader className="px-6 py-5 border-b border-border shrink-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Credit Grant</p>
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
              <div className="h-10 bg-secondary rounded-lg animate-pulse" />
            ) : (
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="bg-secondary border-border h-10">
                  <SelectValue placeholder="Select a credit type" />
                </SelectTrigger>
                <SelectContent>
                  {availableTypes.length === 0 ? (
                    <div className="px-3 py-5 text-center">
                      <p className="text-sm text-muted-foreground">No credit types available</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Go to <strong>Catalog → Credits</strong> to create credit types first
                      </p>
                    </div>
                  ) : (
                    availableTypes.map((ct) => (
                      <SelectItem key={ct.id} value={ct.id}>
                        <div className="flex items-center gap-2 py-0.5">
                          <div className="w-5 h-5 rounded bg-secondary border border-border flex items-center justify-center shrink-0">
                            <Coins className="w-3 h-3 text-amber-500" />
                          </div>
                          <div>
                            <p className="text-sm font-medium">{ct.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{ct.code}</p>
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
                  {amount || "0"} {selectedCredit.unitName || selectedCredit.name} will be granted per reset period
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
                <label htmlFor="autoTopUp" className="text-sm font-medium text-foreground cursor-pointer">
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
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!selectedId || !amount || loading}
            onClick={handleSubmit}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating…</> : "Create plan grant"}
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
  const [subscribedCompanies, setSubscribedCompanies] = useState<PlanCompany[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);

  const loadEntitlements = useCallback(async () => {
    setEntLoading(true);
    try {
      const res = await fetch(`/api/catalog/plans/${plan.id}/entitlements`);
      if (res.ok) {
        const data = await res.json();
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
              className={`text-xs font-semibold ${isFree ? "text-green-600" : ""}`}
            >
              {isFree ? "Free" : planPriceLabel(plan)}
            </Badge>
            {/* Annual price badge */}
            {!isFree && plan.annualPrice && parseFloat(plan.annualPrice) > 0 && (
              <Badge variant="outline" className="text-xs font-semibold text-green-600 border-green-500/30 bg-green-500/5">
                ${parseFloat(plan.annualPrice).toFixed(2)}/yr
                {parseFloat(plan.price) > 0 && (
                  <span className="ml-1 opacity-70">
                    · {Math.round((1 - parseFloat(plan.annualPrice) / (parseFloat(plan.price) * 12)) * 100)}% off
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
                      <><Check className="w-3.5 h-3.5 mr-2 text-green-500" />Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-2" />Copy Plan ID</>
                    )}
                  </DropdownMenuItem>
                  {plan.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/plans", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: plan.id, status: "PUBLISHED" }),
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
                          body: JSON.stringify({ id: plan.id, status: "ARCHIVED" }),
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
                        const data = await res.json().catch(() => ({}) as { error?: string });
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
        <p className="text-sm text-muted-foreground -mt-2">{plan.description}</p>
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
              <h3 className="text-base font-semibold">
                {entitlements.length} Entitlement
                {entitlements.length !== 1 ? "s" : ""}
              </h3>
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {entLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
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
                                  {ent.type === "BOOLEAN" ? (
                                    <ToggleLeft className="w-4 h-4 text-muted-foreground" />
                                  ) : ent.type === "NUMERIC" ? (
                                    <Hash className="w-4 h-4 text-muted-foreground" />
                                  ) : (
                                    <Package className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div>
                                  <p className="text-sm font-medium">{ent.featureName}</p>
                                  <code className="text-xs text-muted-foreground font-mono">{ent.featureKey}</code>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {ent.type === "NUMERIC" ? (
                                <div>
                                  <p className="text-sm font-medium text-foreground">
                                    {ent.value ?? "—"}{" "}
                                    {ent.valueUnit
                                      ? `${ent.valueUnit} per month`
                                      : "per month"}
                                  </p>
                                  <p className="text-xs text-muted-foreground">Numerical limit</p>
                                </div>
                              ) : ent.type === "UNLIMITED" ? (
                                <div className="flex items-center gap-1.5">
                                  <div className="w-2 h-2 rounded-full bg-green-500" />
                                  <span className="text-sm text-foreground">Unlimited</span>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => !toggling && toggleEntitlement(ent.featureKey, !ent.enabled)}
                                  disabled={toggling === ent.featureKey}
                                  className="flex items-center gap-2 group"
                                >
                                  <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors ${ent.enabled ? "bg-green-500" : "bg-input"} ${toggling === ent.featureKey ? "opacity-60" : ""}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${ent.enabled ? "translate-x-4" : "translate-x-0"}`} />
                                  </div>
                                  <span className={`text-sm font-medium ${ent.enabled ? "text-green-600" : "text-muted-foreground"}`}>
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
                                  <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => toggleEntitlement(ent.featureKey, !ent.enabled)}
                                    disabled={toggling === ent.featureKey}
                                  >
                                    {ent.enabled ? "Disable" : "Enable"}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => deleteEntitlement(ent.featureKey)}
                                    disabled={deletingKey === ent.featureKey}
                                    className="text-destructive focus:text-destructive"
                                  >
                                    {deletingKey === ent.featureKey ? (
                                      <><Loader2 className="mr-2 w-4 h-4 animate-spin" />Removing...</>
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
                      <p className="text-sm text-muted-foreground">No entitlements yet</p>
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
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
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
                      <tr key={grant.creditTypeId} className="border-b border-border last:border-0 hover:bg-secondary/10">
                        <td className="py-3 px-4 font-medium flex items-center gap-2">
                          <Coins className="w-3.5 h-3.5 text-amber-500" />
                          {grant.creditTypeId} {/* Ideally show name here, but needs a join or fetch */}
                        </td>
                        <td className="py-3 px-4 text-foreground">
                          {grant.amount} units
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteCreditGrant(grant.creditTypeId)}
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
                    <p className="text-sm font-medium text-muted-foreground">No Credit Grants</p>
                    <p className="text-xs text-muted-foreground/70">
                      Add credit grant to this plan to allocate credits to subscribers.
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
              <RefreshCw className={cn("w-4 h-4 mr-2", companiesLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
          {companiesLoading ? (
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
                  {Array.from({ length: 3 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><div className="h-4 w-32 rounded bg-muted animate-pulse" /></TableCell>
                      <TableCell><div className="h-4 w-40 rounded bg-muted animate-pulse" /></TableCell>
                      <TableCell><div className="h-4 w-24 rounded bg-muted animate-pulse" /></TableCell>
                      <TableCell><div className="h-4 w-24 rounded bg-muted animate-pulse" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                          <p className="font-medium text-foreground">{company.name}</p>
                          {company.email ? (
                            <p className="text-xs text-muted-foreground">{company.email}</p>
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
                          {company.externalId ? <p>ID: {company.externalId}</p> : null}
                          {!company.walletAddress && !company.externalId && !company.email ? (
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
              <p className="text-sm font-medium text-foreground">No companies on this plan</p>
              <p className="text-xs text-muted-foreground max-w-xs text-center">
                Companies with <code className="bg-secondary px-1 rounded">activePlanId = {plan.id}</code> will appear here.
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
                <p className="text-xs text-muted-foreground mb-1.5">Monthly price</p>
                <p className="text-lg font-semibold">
                  {isFree ? (
                    <span className="text-green-500">Free</span>
                  ) : (
                    `$${parseFloat(plan.price).toFixed(2)}`
                  )}
                </p>
                {!isFree && <p className="text-xs text-muted-foreground">USDC / mo</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Annual price</p>
                {plan.annualPrice && parseFloat(plan.annualPrice) > 0 ? (
                  <>
                    <p className="text-lg font-semibold">${parseFloat(plan.annualPrice).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">
                      USDC / yr
                      {parseFloat(plan.price) > 0 && (
                        <span className="ml-1.5 text-green-500 font-medium">
                          {Math.round((1 - parseFloat(plan.annualPrice) / (parseFloat(plan.price) * 12)) * 100)}% off
                        </span>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Billing interval</p>
                <p className="text-lg font-semibold">
                  {plan.billingInterval <= 30
                    ? "Monthly"
                    : plan.billingInterval <= 92
                      ? "Quarterly"
                      : "Annual"}
                </p>
                <p className="text-xs text-muted-foreground">Every {plan.billingInterval} days</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Token</p>
                <p className="text-sm font-medium">USDC</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {plan.acceptedToken.slice(0, 6)}…{plan.acceptedToken.slice(-4)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-2 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Environment</p>
                <EnvBadge mode={plan.environmentMode} />
              </div>
            </div>
          </div>

          {/* On-chain status card */}
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold">On-Chain Status</h3>
              {plan.chainSyncStatus && <ChainSyncBadge status={plan.chainSyncStatus} />}
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
                <div className="flex items-center gap-2 text-green-500 text-sm font-medium">
                  <Check className="w-4 h-4" />
                  Registered on-chain
                </div>
                {plan.onChainPlanId && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/40 border border-border">
                    <p className="text-xs text-muted-foreground">On-chain Plan ID:</p>
                    <code className="text-xs font-mono text-foreground">{plan.onChainPlanId}</code>
                  </div>
                )}
              </div>
            ) : plan.chainSyncStatus === "PENDING" ? (
              <div className="flex items-center justify-between p-4 rounded-lg bg-yellow-500/5 border border-yellow-500/20">
                <div className="flex items-center gap-2 text-yellow-600 text-sm dark:text-yellow-400">
                  <Loader2 className="w-4 h-4" />
                  Pending on-chain registration
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-yellow-500/30 text-yellow-600 hover:bg-yellow-500/10 dark:text-yellow-400"
                  onClick={() => toast.info("Use the Register on-chain button in the plans list")}
                >
                  Register on-chain
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-destructive text-sm p-4 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <div>
                  <p className="font-medium">Sync failed</p>
                  {plan.chainSyncError && (
                    <p className="text-xs text-muted-foreground mt-0.5">{plan.chainSyncError}</p>
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
  const [detailTab, setDetailTab] = useState<"companies" | "billing">("companies");
  const [copiedId, setCopiedId] = useState(false);

  function copyId() {
    navigator.clipboard.writeText(addon.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  const priceLabel = `$${parseFloat(addon.price).toFixed(2)} ${addon.billingType === "ONE_TIME" ? "one-time" : "/ mo"}`;

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
        <span className="text-foreground font-medium uppercase">{addon.name}</span>
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
              <h2 className="text-2xl font-bold text-foreground leading-tight">{addon.name}</h2>
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
            <StatusBadge status={addon.status} />
            <div className="h-6 w-px bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyId}>
                    {copiedId ? (
                      <><Check className="w-3.5 h-3.5 mr-2 text-green-500" />Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-2" />Copy Add-On ID</>
                    )}
                  </DropdownMenuItem>
                  {addon.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/add-ons", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: addon.id, status: "PUBLISHED" }),
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
                          body: JSON.stringify({ id: addon.id, status: "ARCHIVED" }),
                        });
                        onUpdated();
                        toast.success("Add-on archived");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Archive Add-On
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
        <p className="text-sm text-muted-foreground -mt-2">{addon.description}</p>
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
            <h3 className="text-base font-semibold">Companies with this Add-On</h3>
          </div>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/50 border-b border-border">
                <tr>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Company</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Subscribed Since</th>
                  <th className="text-left py-2.5 px-4 font-semibold text-muted-foreground uppercase text-[10px] tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
                        <Package className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                      <p className="text-sm font-medium text-foreground">No companies on this add-on yet</p>
                      <p className="text-xs text-muted-foreground max-w-xs text-center">
                        Companies that purchase this add-on will appear here.
                      </p>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailTab === "billing" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-xl p-6 space-y-6">
            <h3 className="text-base font-semibold">Billing Details</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Price</p>
                <p className="text-lg font-semibold">${parseFloat(addon.price).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">USDC</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Billing Type</p>
                <p className="text-sm font-semibold">
                  {addon.billingType === "ONE_TIME" ? "One-time" : "Recurring"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Token</p>
                <p className="text-sm font-medium">USDC</p>
                <p className="text-xs font-mono text-muted-foreground">
                  {addon.acceptedToken.slice(0, 6)}…{addon.acceptedToken.slice(-4)}
                </p>
              </div>
            </div>
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
          <DialogTitle>{bundle ? "Edit Bundle" : "Create Credit Bundle"}</DialogTitle>
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
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
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
        body: JSON.stringify({ planId: selectedPlanId, amount: parseFloat(amount) }),
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
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
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
  const [detailTab, setDetailTab] = useState<"entitlements" | "companies">("entitlements");
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
      await fetch(`/api/catalog/credits/${credit.id}/bundles?bundleId=${bundleId}`, {
        method: "DELETE",
      });
      setRefresh((n) => n + 1);
      toast.success("Bundle removed");
    } catch {
      toast.error("Failed to remove bundle");
    }
  }

  async function deletePlanGrant(planId: string) {
    if (!window.confirm("Remove this plan grant?")) return;
    try {
      await fetch(`/api/catalog/credits/${credit.id}/plan-grants?planId=${planId}`, {
        method: "DELETE",
      });
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
        <span className="text-foreground font-medium uppercase">{credit.name}</span>
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
              <h2 className="text-2xl font-bold text-foreground leading-tight">{credit.name}</h2>
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
              ${parseFloat(credit.price).toFixed(2)}/credit
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
                      <><Check className="w-3.5 h-3.5 mr-2 text-green-500" />Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-2" />Copy Credit ID</>
                    )}
                  </DropdownMenuItem>
                  {credit.status === "DRAFT" && (
                    <DropdownMenuItem
                      onClick={async () => {
                        await fetch("/api/catalog/credits", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: credit.id, status: "PUBLISHED" }),
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
                          body: JSON.stringify({ id: credit.id, status: "ARCHIVED" }),
                        });
                        onUpdated();
                        toast.success("Credit type archived");
                      }}
                      className="text-destructive focus:text-destructive"
                    >
                      Archive
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
                      <tr key={b.id} className="border-b border-border last:border-0 hover:bg-secondary/10">
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
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
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
                <p className="text-sm font-medium text-muted-foreground">No credit bundles yet</p>
                <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
                  Bundles allow customers to purchase a pack of {credit.unitsPerPack} {credit.unitName} for ${parseFloat(credit.price).toFixed(2)}.
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
                      <tr key={grant.planId} className="border-b border-border last:border-0 hover:bg-secondary/10">
                        <td className="py-3 px-4 font-medium flex items-center gap-2">
                          <Package className="w-3.5 h-3.5 text-blue-500" />
                          {grant.planId} {/* Ideally show plan name here */}
                        </td>
                        <td className="py-3 px-4 text-foreground">
                          {grant.amount} units
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
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
                <p className="text-sm font-medium text-muted-foreground">No plan grants yet</p>
                <p className="text-xs text-muted-foreground/70 max-w-xs text-center">
                  Plan grants automatically allocate {credit.unitName} credits to subscribers of specific plans.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Companies with Credit Grants</h3>
          </div>
          <div className="border border-dashed border-border rounded-xl py-16 flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
              <Coins className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground">No companies yet</p>
            <p className="text-xs text-muted-foreground max-w-xs text-center">
              Companies that have been granted {credit.unitName} credits will appear here.
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
  const { envMode } = useEnvironment();
  const [activeTab, setActiveTab] = useState<CatalogTab>("plans");
  const [refresh, setRefresh] = useState(0);
  const [selectedPlan, setSelectedPlan] = useState<CatalogPlan | null>(null);
  const [selectedAddOn, setSelectedAddOn] = useState<CatalogAddOn | null>(null);
  const [selectedCredit, setSelectedCredit] = useState<CatalogCreditType | null>(null);
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
  }, [envMode]);

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
  }, [envMode]);

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
                            {plan.billingInterval}d
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
                        if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("[role='menuitem']")) return;
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
        <CreditTypesTable env={envMode} refresh={refresh} onSelect={(ct) => { setSelectedCredit(ct); }} />
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
            Create and manage subscription plans. Click a plan to configure entitlements, companies, and billing.
          </p>
        </div>
        <CreatePlanDialog env={envMode} onCreated={tr} />
      </div>
      <PlansTable env={envMode} refresh={refresh} onSelect={setSelectedPlan} />
    </div>
  );
}
