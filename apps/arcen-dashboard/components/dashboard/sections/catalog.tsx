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
  Trash2,
  Search,
  List,
} from "lucide-react";
import { useEnvironment } from "@/contexts/environment-context";
import { useAccount, useSignTypedData, useChainId } from "wagmi";
import { getUsdcAddress, getUsdcTokenOptions } from "@/lib/contracts";
import { toast } from "sonner";
import { SafeTransactionDialog } from "@/components/safe/safe-transaction-dialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type EnvMode = "DEVELOPMENT" | "PRODUCTION";
type CatalogStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

interface CatalogPlan {
  id: string;
  name: string;
  tier: string;
  description?: string | null;
  price: string;
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
}

// ─── Token Options ────────────────────────────────────────────────────────────

const TOKEN_OPTIONS: { label: string; address: string }[] =
  getUsdcTokenOptions().map((option) => ({
    label: option.label,
    address: option.address,
  }));

const DEFAULT_TOKEN = getUsdcAddress(11155111);

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
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [form, setForm] = useState({
    name: "",
    tier: "",
    description: "",
    price: "",
    billingInterval: "30",
    acceptedToken: DEFAULT_TOKEN,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.tier.trim()) e.tier = "Required";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    const bi = Number(form.billingInterval);
    if (!form.billingInterval || isNaN(bi) || bi <= 0 || !Number.isInteger(bi))
      e.billingInterval = "Must be a positive integer (days)";
    if (!form.acceptedToken.trim()) e.acceptedToken = "Required";
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
    setStatus("Creating plan…");
    try {
      const res = await fetch("/api/catalog/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          tier: form.tier,
          description: form.description || undefined,
          price: Number(form.price),
          billingInterval: Number(form.billingInterval),
          acceptedToken: form.acceptedToken,
          environmentMode: env,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to create plan" });
        return;
      }
      const created = await res.json();
      const planId = created.plan?.id ?? created.id;

      // Plan created - user can now register on-chain via the table action
      // (this requires EIP-712 signature, so we don't auto-trigger it here)
      toast.success(
        `Plan created! Click "Register on-chain" in the table to register it with your wallet.`,
      );

      setOpen(false);
      setForm({
        name: "",
        tier: "",
        description: "",
        price: "",
        billingInterval: "30",
        acceptedToken: DEFAULT_TOKEN,
      });
      setErrors({});
      setStatus("");
      onCreated();
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" />
          New Plan
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle>Create Catalog Plan</SheetTitle>
          <SheetDescription>
            Create a clean, publish-ready plan with on-chain registration.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Pro"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Tier *</Label>
              <Input
                value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value })}
                placeholder="pro"
              />
              {errors.tier && (
                <p className="text-xs text-destructive">{errors.tier}</p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Optional description"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Price (USDC) *</Label>
              <Input
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                placeholder="29.00"
                type="number"
                min="0"
                step="0.01"
              />
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label>Billing Interval (days) *</Label>
              <Input
                value={form.billingInterval}
                onChange={(e) =>
                  setForm({ ...form, billingInterval: e.target.value })
                }
                placeholder="30"
                type="number"
                min="1"
              />
              {errors.billingInterval && (
                <p className="text-xs text-destructive">
                  {errors.billingInterval}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <Label>Accepted Token *</Label>
            <Select
              value={form.acceptedToken}
              onValueChange={(v) =>
                setForm({ ...form, acceptedToken: v as `0x${string}` })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select token" />
              </SelectTrigger>
              <SelectContent>
                {TOKEN_OPTIONS.map((t) => (
                  <SelectItem key={t.address} value={t.address}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.acceptedToken && (
              <p className="text-xs text-destructive">{errors.acceptedToken}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Environment: <strong>{env}</strong> — plan will be created and
            registered on-chain automatically.
          </p>
          <SheetFooter className="pt-4 border-t border-border flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="gap-2 min-w-44">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {status || "Processing…"}
                </>
              ) : (
                "Create Plan"
              )}
            </Button>
          </SheetFooter>
        </form>
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
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    billingType: "ONE_TIME" as "ONE_TIME" | "RECURRING",
    price: "",
    acceptedToken: DEFAULT_TOKEN,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.code.trim()) e.code = "Required";
    else if (!/^[a-z0-9_\-]+$/i.test(form.code))
      e.code = "Only letters, numbers, _ and - allowed";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    if (!form.acceptedToken.trim()) e.acceptedToken = "Required";
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
      const res = await fetch("/api/catalog/add-ons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          description: form.description || undefined,
          billingType: form.billingType,
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
          environmentMode: env,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setForm({
          name: "",
          code: "",
          description: "",
          billingType: "ONE_TIME",
          price: "",
          acceptedToken: DEFAULT_TOKEN,
        });
        setErrors({});
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Add-On
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle>Create Add-On Product</SheetTitle>
          <SheetDescription>
            Add-ons are additional features or services customers can purchase
            alongside their plans. They work independently and don't require
            existing plans.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="addonName">Name *</Label>
              <Input
                id="addonName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Extra Storage, Priority Support"
                className="bg-secondary border-border focus:border-accent"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="addonCode">Code *</Label>
              <Input
                id="addonCode"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. extra-storage"
                className="bg-secondary border-border focus:border-accent font-mono text-sm"
              />
              {errors.code && (
                <p className="text-xs text-destructive">{errors.code}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="addonDescription">Description (Optional)</Label>
            <Input
              id="addonDescription"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              placeholder="Describe what this add-on provides"
              className="bg-secondary border-border focus:border-accent"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="addonBillingType">Billing Type *</Label>
              <Select
                value={form.billingType}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    billingType: v as "ONE_TIME" | "RECURRING",
                  })
                }
              >
                <SelectTrigger
                  id="addonBillingType"
                  className="bg-secondary border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ONE_TIME">One-Time Purchase</SelectItem>
                  <SelectItem value="RECURRING">Recurring (Monthly)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="addonPrice">Price (USDC) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="addonPrice"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="9.99"
                  type="number"
                  min="0"
                  step="0.01"
                  className="bg-secondary border-border focus:border-accent pl-6"
                />
              </div>
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="addonToken">Accepted Token *</Label>
            <Select
              value={form.acceptedToken}
              onValueChange={(v) =>
                setForm({ ...form, acceptedToken: v as `0x${string}` })
              }
            >
              <SelectTrigger
                id="addonToken"
                className="bg-secondary border-border"
              >
                <SelectValue placeholder="Select token" />
              </SelectTrigger>
              <SelectContent>
                {TOKEN_OPTIONS.map((t) => (
                  <SelectItem key={t.address} value={t.address}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.acceptedToken && (
              <p className="text-xs text-destructive">{errors.acceptedToken}</p>
            )}
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
            <span className="text-xs text-muted-foreground">
              Environment:{" "}
              <span className="text-foreground font-medium">{env}</span> —
              Add-on will be saved as Draft until published.
            </span>
          </div>
          <SheetFooter className="pt-4 border-t border-border flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Add-On"}
            </Button>
          </SheetFooter>
        </form>
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
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    unitName: "",
    unitsPerPack: "100",
    price: "",
    acceptedToken: DEFAULT_TOKEN,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = "Required";
    if (!form.code.trim()) e.code = "Required";
    else if (!/^[a-z0-9_\-]+$/i.test(form.code))
      e.code = "Only letters, numbers, _ and - allowed";
    if (!form.unitName.trim()) e.unitName = "Required";
    const upp = Number(form.unitsPerPack);
    if (!form.unitsPerPack || isNaN(upp) || upp <= 0 || !Number.isInteger(upp))
      e.unitsPerPack = "Must be a positive integer";
    const p = Number(form.price);
    if (!form.price || isNaN(p) || p <= 0) e.price = "Must be positive";
    if (!form.acceptedToken.trim()) e.acceptedToken = "Required";
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          code: form.code,
          unitName: form.unitName,
          unitsPerPack: Number(form.unitsPerPack),
          price: Number(form.price),
          acceptedToken: form.acceptedToken,
          environmentMode: env,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setForm({
          name: "",
          code: "",
          unitName: "",
          unitsPerPack: "100",
          price: "",
          acceptedToken: DEFAULT_TOKEN,
        });
        setErrors({});
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Create Credit Type
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle>Create Credit Type</SheetTitle>
          <SheetDescription>
            Credit types define units of consumption that can be granted through
            plans or purchased separately. Perfect for usage-based billing and
            metered features.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="creditName">Name *</Label>
              <Input
                id="creditName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. API Calls, Storage GB"
                className="bg-secondary border-border focus:border-accent"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditCode">Code *</Label>
              <Input
                id="creditCode"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. api-calls"
                className="bg-secondary border-border focus:border-accent font-mono text-sm"
              />
              {errors.code && (
                <p className="text-xs text-destructive">{errors.code}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="creditUnitName">Unit Name *</Label>
              <Input
                id="creditUnitName"
                value={form.unitName}
                onChange={(e) => setForm({ ...form, unitName: e.target.value })}
                placeholder="e.g. calls, gigabytes"
                className="bg-secondary border-border focus:border-accent"
              />
              {errors.unitName && (
                <p className="text-xs text-destructive">{errors.unitName}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditUnitsPerPack">Units per Pack *</Label>
              <Input
                id="creditUnitsPerPack"
                value={form.unitsPerPack}
                onChange={(e) =>
                  setForm({ ...form, unitsPerPack: e.target.value })
                }
                placeholder="100"
                type="number"
                min="1"
                className="bg-secondary border-border focus:border-accent"
              />
              {errors.unitsPerPack && (
                <p className="text-xs text-destructive">
                  {errors.unitsPerPack}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="creditPrice">Price per Pack (USDC) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="creditPrice"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="5.00"
                  type="number"
                  min="0"
                  step="0.01"
                  className="bg-secondary border-border focus:border-accent pl-6"
                />
              </div>
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditToken">Accepted Token *</Label>
              <Select
                value={form.acceptedToken}
                onValueChange={(v) =>
                  setForm({ ...form, acceptedToken: v as `0x${string}` })
                }
              >
                <SelectTrigger
                  id="creditToken"
                  className="bg-secondary border-border"
                >
                  <SelectValue placeholder="Select token" />
                </SelectTrigger>
                <SelectContent>
                  {TOKEN_OPTIONS.map((t) => (
                    <SelectItem key={t.address} value={t.address}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.acceptedToken && (
                <p className="text-xs text-destructive">
                  {errors.acceptedToken}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
            <span className="text-xs text-muted-foreground">
              Environment:{" "}
              <span className="text-foreground font-medium">{env}</span> —
              Credit type will be saved as Draft until published.
            </span>
          </div>
          <SheetFooter className="pt-4 border-t border-border flex-row justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Credit Type"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Plans Table ───────────────────────────────────────────────────────────────

function PlansTable({ env, refresh }: { env: EnvMode; refresh: number }) {
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
      toast.error("Please connect your wallet first");
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
      const { nonce, planFactoryAddress, domain } = await nonceRes.json();

      // 2. Prepare plan parameters for signing
      const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
      const priceInUsdc = BigInt(
        Math.round(parseFloat(plan.price) * 1_000_000),
      );
      const billingIntervalSeconds = plan.billingInterval * 86400;

      // 3. Sign EIP-712 typed data
      const signature = await signTypedDataAsync({
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
          provider: address,
          name: plan.name,
          tier: plan.tier,
          price: priceInUsdc,
          billingInterval: billingIntervalSeconds,
          acceptedToken: plan.acceptedToken as `0x${string}`,
          metadataURI: "",
          nonce: BigInt(nonce),
          deadline: BigInt(deadline),
        },
      });

      // 4. Submit to API with signature
      const res = await fetch(
        `/api/catalog/plans/${plan.id}/register-on-chain`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signature,
            deadline,
            userAddress: address,
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
      toast.success(
        `Plan registered on-chain — you are the owner! Tx: ${(data.txHash ?? "").slice(0, 10)}…`,
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
        toast.error("Signature request was rejected");
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
              const needsChainSync =
                plan.status !== "ARCHIVED" && plan.chainSyncStatus !== "SYNCED";
              return (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {plan.tier}
                  </TableCell>
                  <TableCell>{parseFloat(plan.price).toFixed(2)}</TableCell>
                  <TableCell>{plan.billingInterval}d</TableCell>
                  <TableCell className="text-xs">
                    {tokenLabel(plan.acceptedToken)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell>
                    {plan.chainSyncStatus &&
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
                        {needsChainSync && (
                          <DropdownMenuItem
                            onClick={() => registerOnChain(plan)}
                            disabled={syncingPlanId === plan.id}
                          >
                            {syncingPlanId === plan.id
                              ? "Registering…"
                              : "Register On-Chain"}
                          </DropdownMenuItem>
                        )}
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
          planId={entTarget.id}
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

function AddOnsTable({ env, refresh }: { env: EnvMode; refresh: number }) {
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
                <TableRow key={addon.id}>
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

function CreditTypesTable({ env, refresh }: { env: EnvMode; refresh: number }) {
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
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Units/Pack</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>v</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {creditTypes.map((ct) => {
              const transitions = NEXT_STATUS[ct.status] ?? [];
              return (
                <TableRow key={ct.id}>
                  <TableCell className="font-medium">{ct.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {ct.code}
                  </TableCell>
                  <TableCell className="text-xs">{ct.unitName}</TableCell>
                  <TableCell>{ct.unitsPerPack}</TableCell>
                  <TableCell>{parseFloat(ct.price).toFixed(2)}</TableCell>
                  <TableCell className="text-xs">
                    {tokenLabel(ct.acceptedToken)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={ct.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    v{ct.version}
                  </TableCell>
                  <TableCell>
                    {transitions.length > 0 && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={updating === ct.id}
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                    )}
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
  { chainId: number; name: string; color: string }
> = {
  DEVELOPMENT: {
    chainId: 11155111,
    name: "Sepolia (Testnet)",
    color: "bg-blue-400",
  },
  PRODUCTION: { chainId: 8453, name: "Base Mainnet", color: "bg-orange-400" },
};

type CatalogConfigSettings = {
  initialPlan: string;
  fallbackPlan: string;
  showBillingPeriodToggle: boolean;
  freePlanPriceDisplay: boolean;
  hideCredits: boolean;
  yearlyDiscountDisplay: boolean;
  showFeatureDescriptions: boolean;
  showHardLimits: boolean;
  upgradeImmediately: boolean;
  downgradeImmediately: boolean;
  preventDowngradeOverLimit: boolean;
  disallowSelfServiceDowngrade: boolean;
};

const DEFAULT_CONFIG_SETTINGS: CatalogConfigSettings = {
  initialPlan: "Free",
  fallbackPlan: "none",
  showBillingPeriodToggle: true,
  freePlanPriceDisplay: true,
  hideCredits: false,
  yearlyDiscountDisplay: true,
  showFeatureDescriptions: true,
  showHardLimits: true,
  upgradeImmediately: true,
  downgradeImmediately: false,
  preventDowngradeOverLimit: true,
  disallowSelfServiceDowngrade: false,
};

function ConfigurationTab() {
  const { envMode, setEnvMode } = useEnvironment();
  const [switchTarget, setSwitchTarget] = useState<EnvMode>("DEVELOPMENT");
  const [confirmText, setConfirmText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSavedMessage, setConfigSavedMessage] = useState<string | null>(
    null,
  );

  // Configuration settings state
  const [settings, setSettings] = useState<CatalogConfigSettings>(
    DEFAULT_CONFIG_SETTINGS,
  );

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      setLoadingConfig(true);
      setConfigError(null);
      try {
        const res = await fetch(
          `/api/catalog/config?environmentMode=${envMode}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Failed to load configuration");
        }
        if (cancelled) return;

        const config = (data.config ?? {}) as Partial<CatalogConfigSettings> & {
          fallbackPlan?: string | null;
        };
        setSettings({
          ...DEFAULT_CONFIG_SETTINGS,
          ...config,
          fallbackPlan: config.fallbackPlan || "none",
        });
      } catch (err: unknown) {
        if (cancelled) return;
        setConfigError(
          err instanceof Error ? err.message : "Failed to load configuration",
        );
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    }

    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [envMode]);

  async function handleSaveSettings() {
    setSavingConfig(true);
    setConfigError(null);
    setConfigSavedMessage(null);
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
      if (!res.ok) {
        throw new Error(data.error || "Failed to save configuration");
      }
      setConfigSavedMessage(
        `Configuration saved for ${envMode === "PRODUCTION" ? "Mainnet" : "Testnet"}.`,
      );
    } catch (err: unknown) {
      setConfigError(
        err instanceof Error ? err.message : "Failed to save configuration",
      );
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSwitch(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText !== "CONFIRM") return;
    setSwitching(true);
    setSwitchError(null);
    setSwitchResult(null);
    try {
      const res = await fetch("/api/environment/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          environmentMode: switchTarget,
          confirmText: "CONFIRM",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnvMode(data.environmentMode as EnvMode);
        setSwitchResult(
          `Switched to ${data.environmentMode} (Chain ${data.chainId})`,
        );
        setDialogOpen(false);
        setConfirmText("");
      } else {
        setSwitchError(data.error || "Switch failed");
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setSettings(DEFAULT_CONFIG_SETTINGS);
            setConfigSavedMessage(null);
            setConfigError(null);
          }}
          disabled={loadingConfig || savingConfig}
        >
          Reset
        </Button>
        <Button
          size="sm"
          onClick={handleSaveSettings}
          disabled={loadingConfig || savingConfig}
          className="gap-2"
        >
          {savingConfig ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save configuration"
          )}
        </Button>
      </div>
      {configError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {configError}
        </div>
      )}
      {configSavedMessage && (
        <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-600 dark:text-green-400">
          {configSavedMessage}
        </div>
      )}

      {/* Initial Plan Configuration */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Initial Plan Configuration
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Set default plans for new companies and subscription fallbacks.
          </p>
        </div>
        <div className="p-6 space-y-6">
          <div className="space-y-3">
            <Label
              htmlFor="initial-plan"
              className="text-sm font-semibold text-foreground"
            >
              Initial Plan
            </Label>
            <Select
              value={settings.initialPlan}
              onValueChange={(v) =>
                setSettings({ ...settings, initialPlan: v })
              }
            >
              <SelectTrigger
                id="initial-plan"
                className="bg-background border-border hover:border-foreground/30 transition-colors max-w-md h-11"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Free">Free</SelectItem>
                <SelectItem value="Starter">Starter</SelectItem>
                <SelectItem value="Pro">Pro</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The plan assigned to new companies upon sign-up. Companies will
              automatically be assigned to this plan when they first subscribe.
            </p>
          </div>

          <div className="h-px bg-border/50" />

          <div className="space-y-3">
            <Label
              htmlFor="fallback-plan"
              className="text-sm font-semibold text-foreground"
            >
              Fallback Plan
            </Label>
            <Select
              value={settings.fallbackPlan}
              onValueChange={(v) =>
                setSettings({ ...settings, fallbackPlan: v })
              }
            >
              <SelectTrigger
                id="fallback-plan"
                className="bg-background border-border hover:border-foreground/30 transition-colors max-w-md h-11"
              >
                <SelectValue placeholder="No fallback plan selected" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="Free">Free</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Choose a plan all companies are assigned to if they don't have an
              active plan. Leave as "None" to require manual assignment.
            </p>
          </div>
        </div>
      </div>

      {/* Component Display Settings */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Component Display Settings
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure how plans, features, and billing data is displayed across
            all components.
          </p>
        </div>

        <div className="divide-y divide-border/50">
          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="billing-toggle"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Show billing period toggle
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Filter plans by billing period (yearly and monthly) in checkout
                and pricing table
              </p>
            </div>
            <Switch
              id="billing-toggle"
              checked={settings.showBillingPeriodToggle}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, showBillingPeriodToggle: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="free-price"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Free plan price display
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Show the word "Free" in checkout and pricing table instead of
                "$0.00"
              </p>
            </div>
            <Switch
              id="free-price"
              checked={settings.freePlanPriceDisplay}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, freePlanPriceDisplay: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="hide-credits"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Hide credits
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Obscure credit balance and consumption rate from checkout and
                other elements
              </p>
            </div>
            <Switch
              id="hide-credits"
              checked={settings.hideCredits}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, hideCredits: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="yearly-discount"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Yearly discount display
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Display billed yearly prices as monthly. E.g "$120/year" is
                shown as "$10/month, billed yearly"
              </p>
            </div>
            <Switch
              id="yearly-discount"
              checked={settings.yearlyDiscountDisplay}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, yearlyDiscountDisplay: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="feature-desc"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Show feature descriptions
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Show descriptions in checkout for plan entitlements
              </p>
            </div>
            <Switch
              id="feature-desc"
              checked={settings.showFeatureDescriptions}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, showFeatureDescriptions: checked })
              }
            />
          </div>

          <div className="flex items-start justify-between gap-6 p-6 hover:bg-secondary/10 transition-colors">
            <div className="space-y-1.5 flex-1">
              <Label
                htmlFor="hard-limits"
                className="text-sm font-semibold text-foreground cursor-pointer"
              >
                Show hard limits
              </Label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Surface defined hard limits for relevant entitlements
              </p>
            </div>
            <Switch
              id="hard-limits"
              checked={settings.showHardLimits}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, showHardLimits: checked })
              }
            />
          </div>
        </div>
      </div>

      {/* Plan Change Rules */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Plan Change Rules
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Smart contracts will validate plan changes based on the following
            rules
          </p>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-xl border border-green-500/20 bg-linear-to-br from-green-500/5 to-green-500/10 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-sm" />
              <h4 className="text-sm font-bold text-foreground">On Upgrade</h4>
            </div>
            <div className="pl-4 border-l-2 border-green-500/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                • Switching to a higher cost plan
                <br />• Add an add-on
              </p>
            </div>
            <div className="flex items-start justify-between gap-6 pt-2">
              <div className="space-y-1.5 flex-1">
                <Label
                  htmlFor="upgrade-immediate"
                  className="text-sm font-semibold text-foreground cursor-pointer"
                >
                  Upgrade immediately, invoice immediately
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Apply upgrades and charge the difference immediately on-chain
                </p>
              </div>
              <Switch
                id="upgrade-immediate"
                checked={settings.upgradeImmediately}
                onCheckedChange={(checked) =>
                  setSettings({ ...settings, upgradeImmediately: checked })
                }
              />
            </div>
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-linear-to-br from-orange-500/5 to-orange-500/10 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-orange-500 shadow-sm" />
              <h4 className="text-sm font-bold text-foreground">
                On Downgrade
              </h4>
            </div>
            <div className="pl-4 border-l-2 border-orange-500/20">
              <p className="text-xs text-muted-foreground leading-relaxed">
                • Switching to a lower cost plan
                <br />• Remove an add-on
              </p>
            </div>
            <div className="space-y-4 pt-2">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label
                    htmlFor="downgrade-immediate"
                    className="text-sm font-semibold text-foreground cursor-pointer"
                  >
                    Downgrade immediately, apply credit for next period
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Apply downgrades immediately and credit the difference to
                    the customer's wallet
                  </p>
                </div>
                <Switch
                  id="downgrade-immediate"
                  checked={settings.downgradeImmediately}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, downgradeImmediately: checked })
                  }
                />
              </div>

              <div className="h-px bg-border/50" />

              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label
                    htmlFor="prevent-downgrade"
                    className="text-sm font-semibold text-foreground cursor-pointer"
                  >
                    Prevent downgrades when over the limit
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Disallow downgrades when the user is above the limit for the
                    destination plan
                  </p>
                </div>
                <Switch
                  id="prevent-downgrade"
                  checked={settings.preventDowngradeOverLimit}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      preventDowngradeOverLimit: checked,
                    })
                  }
                />
              </div>

              <div className="h-px bg-border/50" />

              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label
                    htmlFor="disallow-self-downgrade"
                    className="text-sm font-semibold text-foreground cursor-pointer"
                  >
                    Disallow self-service downgrades
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Require users to contact support to downgrade their plan
                  </p>
                </div>
                <Switch
                  id="disallow-self-downgrade"
                  checked={settings.disallowSelfServiceDowngrade}
                  onCheckedChange={(checked) =>
                    setSettings({
                      ...settings,
                      disallowSelfServiceDowngrade: checked,
                    })
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contract Settings */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Contract Settings
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Configure smart contract behavior and on-chain subscription
            parameters.
          </p>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-xl border border-border/40 bg-secondary/5 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-xs font-bold text-primary">⚡</span>
              </div>
              <h4 className="text-sm font-bold text-foreground">
                Gas Optimization
              </h4>
            </div>
            <div className="space-y-4 pl-1">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">
                    Batch subscription operations
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Combine multiple subscription actions into a single
                    transaction to reduce gas costs
                  </p>
                </div>
                <Switch defaultChecked={true} />
              </div>

              <div className="h-px bg-border/50" />

              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">
                    Enable meta-transactions
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Allow gasless transactions where the platform pays gas fees
                    for users
                  </p>
                </div>
                <Switch defaultChecked={false} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/40 bg-secondary/5 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                <span className="text-xs font-bold text-primary">🔄</span>
              </div>
              <h4 className="text-sm font-bold text-foreground">
                Subscription Behavior
              </h4>
            </div>
            <div className="space-y-4 pl-1">
              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">
                    Auto-renew subscriptions
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Automatically renew subscriptions on-chain when they expire
                  </p>
                </div>
                <Switch defaultChecked={true} />
              </div>

              <div className="h-px bg-border/50" />

              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">
                    Grace period on payment failure
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Give subscribers 3 days to resolve payment issues before
                    suspending access
                  </p>
                </div>
                <Switch defaultChecked={true} />
              </div>

              <div className="h-px bg-border/50" />

              <div className="flex items-start justify-between gap-6">
                <div className="space-y-1.5 flex-1">
                  <Label className="text-sm font-semibold text-foreground cursor-pointer">
                    Emit subscription events
                  </Label>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Emit detailed events for all subscription changes for
                    off-chain indexing
                  </p>
                </div>
                <Switch defaultChecked={true} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Chain mapping table */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Chain Mapping
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Environment modes are mapped to specific blockchain networks for
            contract deployments.
          </p>
        </div>
        <div className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/10">
                <th className="text-left py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Environment
                </th>
                <th className="text-left py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Network
                </th>
                <th className="text-left py-4 px-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chain ID
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {(
                Object.entries(CHAIN_INFO) as [
                  EnvMode,
                  (typeof CHAIN_INFO)[EnvMode],
                ][]
              ).map(([mode, info]) => (
                <tr
                  key={mode}
                  className="hover:bg-secondary/10 transition-colors"
                >
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${info.color} shadow-sm`}
                      />
                      <span className="font-semibold text-sm text-foreground">
                        {mode}
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-sm text-muted-foreground">
                    {info.name}
                  </td>
                  <td className="py-4 px-6 font-mono text-sm font-medium text-muted-foreground">
                    {info.chainId}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Environment switch */}
      <div className="rounded-xl border border-border/50 bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border/50 bg-secondary/20">
          <h3 className="text-lg font-semibold text-foreground tracking-tight">
            Switch Environment
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Switching the team environment affects which blockchain network your
            catalog data is published to. Production switches require deployed
            contracts.
          </p>
        </div>
        <div className="p-6">
          <Sheet open={dialogOpen} onOpenChange={setDialogOpen}>
            <SheetTrigger asChild>
              <Button
                size="default"
                variant="outline"
                className="gap-2 h-11 px-6 hover:bg-secondary transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Switch Environment
              </Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-xl">Switch Environment</SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  Change the active environment mode for your team. This affects
                  which blockchain network your catalog data is published to.
                </SheetDescription>
              </SheetHeader>
              <form onSubmit={handleSwitch} className="space-y-6 py-4">
                <div className="space-y-3">
                  <Label htmlFor="target-env" className="text-sm font-semibold">
                    Target Environment
                  </Label>
                  <Select
                    value={switchTarget}
                    onValueChange={(v) => setSwitchTarget(v as EnvMode)}
                  >
                    <SelectTrigger
                      id="target-env"
                      className="bg-background border-border h-11"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEVELOPMENT">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                          <span>Development (Sepolia Testnet)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="PRODUCTION">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                          <span>Production (Base Mainnet)</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {switchTarget === "PRODUCTION" && (
                  <div className="flex items-start gap-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-orange-500" />
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                        Production deployment required
                      </p>
                      <p className="text-xs text-orange-600/80 dark:text-orange-400/80 leading-relaxed">
                        Ensure your contracts are deployed on Base Mainnet with
                        non-zero addresses before proceeding.
                      </p>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  <Label
                    htmlFor="confirm-text"
                    className="text-sm font-semibold"
                  >
                    Type{" "}
                    <span className="font-bold text-foreground">CONFIRM</span>{" "}
                    to proceed
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
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-destructive" />
                    <span className="text-sm font-medium text-destructive">
                      {switchError}
                    </span>
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      setConfirmText("");
                      setSwitchError(null);
                    }}
                    className="h-11 px-6"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={confirmText !== "CONFIRM" || switching}
                    className="min-w-28 h-11 px-6"
                  >
                    {switching ? "Switching…" : "Switch"}
                  </Button>
                </div>
              </form>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </div>
  );
}

// ─── Standalone Section Pages ───────────────────────────────────────────────────

export function CatalogAddOnsSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  function tr() {
    setRefresh((n) => n + 1);
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
      <AddOnsTable env={envMode} refresh={refresh} />
    </div>
  );
}

export function CatalogCreditsSection() {
  const { envMode } = useEnvironment();
  const [refresh, setRefresh] = useState(0);
  function tr() {
    setRefresh((n) => n + 1);
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
      <CreditTypesTable env={envMode} refresh={refresh} />
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
  enabled: boolean;
}

// ─── Add Entitlement Dialog ────────────────────────────────────────────────────

function AddEntitlementDialog({
  planId,
  onAdded,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
}: {
  planId: string;
  onAdded: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    featureName: "",
    featureKey: "",
    type: "BOOLEAN" as "BOOLEAN" | "NUMERIC" | "UNLIMITED",
    value: "",
    enabled: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function autoKey(name: string) {
    return name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "");
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!form.featureName.trim()) e.featureName = "Required";
    if (!form.featureKey.trim()) e.featureKey = "Required";
    else if (!/^[a-z0-9_-]+$/i.test(form.featureKey))
      e.featureKey = "Letters, numbers, _ and - only";
    if (form.type === "NUMERIC") {
      const n = Number(form.value);
      if (form.value === "" || isNaN(n) || n < 0)
        e.value = "Must be a non-negative number";
    }
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
      let val: boolean | number | null = null;
      if (form.type === "BOOLEAN") val = form.enabled;
      else if (form.type === "NUMERIC") val = Number(form.value);
      const res = await fetch(`/api/catalog/plans/${planId}/entitlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureName: form.featureName,
          featureKey: form.featureKey,
          type: form.type,
          value: val,
          enabled: form.enabled,
        }),
      });
      if (res.ok) {
        setOpen(false);
        setForm({
          featureName: "",
          featureKey: "",
          type: "BOOLEAN",
          value: "",
          enabled: true,
        });
        setErrors({});
        onAdded();
        toast.success("Entitlement added");
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to add entitlement" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {externalOpen === undefined && (
        <SheetTrigger asChild>
          <Button className="gap-2">
            <Plus className="w-4 h-4" />
            Add entitlement
          </Button>
        </SheetTrigger>
      )}
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle>Add Entitlement</SheetTitle>
          <SheetDescription>
            Add a feature entitlement to this plan.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="entFeatureName">Feature Name *</Label>
            <Input
              id="entFeatureName"
              value={form.featureName}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  featureName: name,
                  featureKey: f.featureKey || autoKey(name),
                }));
              }}
              placeholder="e.g. Advanced Analytics"
              className="bg-secondary border-border"
            />
            {errors.featureName && (
              <p className="text-xs text-destructive">{errors.featureName}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="entFeatureKey">Feature Key *</Label>
            <Input
              id="entFeatureKey"
              value={form.featureKey}
              onChange={(e) =>
                setForm((f) => ({ ...f, featureKey: e.target.value }))
              }
              placeholder="e.g. advanced_analytics"
              className="bg-secondary border-border font-mono text-sm"
            />
            {errors.featureKey && (
              <p className="text-xs text-destructive">{errors.featureKey}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Entitlement Type *</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["BOOLEAN", "NUMERIC", "UNLIMITED"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t, value: "" }))}
                  className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-lg border text-xs font-medium transition-all ${
                    form.type === t
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
          {form.type === "NUMERIC" && (
            <div className="space-y-2">
              <Label htmlFor="entValue">Value *</Label>
              <Input
                id="entValue"
                type="number"
                min="0"
                value={form.value}
                onChange={(e) =>
                  setForm((f) => ({ ...f, value: e.target.value }))
                }
                placeholder="e.g. 1000"
                className="bg-secondary border-border"
              />
              {errors.value && (
                <p className="text-xs text-destructive">{errors.value}</p>
              )}
            </div>
          )}
          <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 border border-border">
            <div>
              <p className="text-sm font-medium">Enabled</p>
              <p className="text-xs text-muted-foreground">
                Is this entitlement active on the plan?
              </p>
            </div>
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding…
                </>
              ) : (
                "Add Entitlement"
              )}
            </Button>
          </div>
        </form>
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
  const [internalOpen, setInternalOpen] = useState(false);
  const open = externalOpen !== undefined ? externalOpen : internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: plan.name,
    tier: plan.tier,
    description: plan.description ?? "",
    price: parseFloat(plan.price).toFixed(2),
    billingInterval: String(plan.billingInterval),
    acceptedToken: plan.acceptedToken,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Required";
    if (!form.tier.trim()) errs.tier = "Required";
    if (!form.price || isNaN(Number(form.price)) || Number(form.price) <= 0)
      errs.price = "Must be positive";
    if (
      !form.billingInterval ||
      isNaN(Number(form.billingInterval)) ||
      Number(form.billingInterval) <= 0
    )
      errs.billingInterval = "Required";
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
          tier: form.tier,
          description: form.description || undefined,
          price: Number(form.price),
          billingInterval: Number(form.billingInterval),
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
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pb-4 border-b border-border">
          <SheetTitle>Edit Plan</SheetTitle>
          <SheetDescription>
            Update plan settings. Changes are saved to the catalog.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          {errors._global && (
            <p className="text-sm text-destructive">{errors._global}</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="editPlanName">Name *</Label>
              <Input
                id="editPlanName"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                className="bg-secondary border-border"
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPlanTier">Tier *</Label>
              <Input
                id="editPlanTier"
                value={form.tier}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tier: e.target.value }))
                }
                className="bg-secondary border-border"
              />
              {errors.tier && (
                <p className="text-xs text-destructive">{errors.tier}</p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPlanDesc">Description</Label>
            <Input
              id="editPlanDesc"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              placeholder="Optional"
              className="bg-secondary border-border"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="editPlanPrice">Price (USDC) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <Input
                  id="editPlanPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, price: e.target.value }))
                  }
                  className="bg-secondary border-border pl-6"
                />
              </div>
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="editPlanInterval">
                Billing Interval (days) *
              </Label>
              <Input
                id="editPlanInterval"
                type="number"
                min="1"
                value={form.billingInterval}
                onChange={(e) =>
                  setForm((f) => ({ ...f, billingInterval: e.target.value }))
                }
                className="bg-secondary border-border"
              />
              {errors.billingInterval && (
                <p className="text-xs text-destructive">
                  {errors.billingInterval}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="editPlanToken">Accepted Token *</Label>
            <Input
              id="editPlanToken"
              value={form.acceptedToken}
              onChange={(e) =>
                setForm((f) => ({ ...f, acceptedToken: e.target.value }))
              }
              className="bg-secondary border-border"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
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
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Plan Detail View ──────────────────────────────────────────────────────────

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
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

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

  useEffect(() => {
    loadEntitlements();
  }, [loadEntitlements, entRefresh]);

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

  function copyId() {
    navigator.clipboard.writeText(plan.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  const DETAIL_TABS = ["entitlements", "companies", "billing"] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Breadcrumb */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Plans
      </button>

      {/* Plan header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/30 to-accent/10 border border-border flex items-center justify-center text-xl font-bold text-accent">
            {plan.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{plan.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <button
                onClick={copyId}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-mono transition-colors"
              >
                <span>{plan.id.slice(0, 20)}…</span>
                {copiedId ? (
                  <Check className="w-3 h-3 text-green-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </div>
            {plan.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {plan.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Type</p>
            <p className="text-sm font-medium flex items-center gap-1">
              <Package className="w-3.5 h-3.5" /> Plan
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Status</p>
            <StatusBadge status={plan.status} />
          </div>
          <EditPlanDialog plan={plan} onSaved={onUpdated} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={copyId}>Copy Plan ID</DropdownMenuItem>
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
                  Publish
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
                  className="h-9 w-52 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
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
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {entitlements.length > 0 && (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-secondary/50">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Feature
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Entitlement
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Type
                        </th>
                        <th className="w-12" />
                      </tr>
                    </thead>
                    <tbody>
                      {entitlements.map((ent) => (
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
                            <div className="flex items-center gap-2">
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
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${ent.enabled ? "bg-accent" : "bg-input"} ${toggling === ent.featureKey ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                              >
                                <span
                                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${ent.enabled ? "translate-x-4" : "translate-x-0"}`}
                                />
                              </button>
                              <span className="text-sm text-foreground">
                                {ent.type === "NUMERIC"
                                  ? ent.value
                                  : ent.enabled
                                    ? "On"
                                    : "Off"}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <Badge
                              variant="outline"
                              className="text-xs capitalize"
                            >
                              {ent.type === "BOOLEAN"
                                ? "Boolean"
                                : ent.type === "NUMERIC"
                                  ? "Numeric"
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
              )}

              <div className="flex items-center gap-3">
                <AddEntitlementDialog
                  planId={plan.id}
                  onAdded={() => setEntRefresh((n) => n + 1)}
                />
              </div>
            </>
          )}
        </div>
      )}

      {detailTab === "companies" && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
            <Package className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground mb-1">
            No companies subscribed
          </p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Companies that subscribe to this plan will appear here.
          </p>
        </div>
      )}

      {detailTab === "billing" && (
        <div className="bg-card border border-border rounded-xl p-6 space-y-4">
          <h3 className="text-base font-semibold">Billing Details</h3>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Price</p>
              <p className="text-lg font-semibold">
                ${parseFloat(plan.price).toFixed(2)} USDC
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Billing Interval
              </p>
              <p className="text-lg font-semibold">
                {plan.billingInterval} days
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Accepted Token
              </p>
              <p className="text-sm font-medium font-mono">
                {tokenLabel(plan.acceptedToken)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Environment</p>
              <EnvBadge mode={plan.environmentMode} />
            </div>
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

  const TABS: { key: CatalogTab; label: string; count?: number }[] = [
    { key: "plans", label: "Plan", count: plans.length },
    { key: "addons", label: "Add-on", count: addOns.length },
    { key: "credits", label: "Credit Types" },
    { key: "config", label: "Configuration" },
  ];

  return (
    <div className="space-y-0">
      {/* Tab bar header — matches Schematic style */}
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
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/30 to-accent/10 border border-border flex items-center justify-center text-sm font-bold text-accent"></div>
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
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors"
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
        <CreditTypesTable env={envMode} refresh={refresh} />
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

  function tr() {
    setRefresh((n) => n + 1);
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card to-secondary/25 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Plans Catalog
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Create and manage production-ready catalog plans. Plan data is
              scoped to the active environment, and switching environment
              instantly loads that network's dataset.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <CreatePlanDialog env={envMode} onCreated={tr} />
          </div>
        </div>
      </div>
      <PlansTable env={envMode} refresh={refresh} />
    </div>
  );
}
