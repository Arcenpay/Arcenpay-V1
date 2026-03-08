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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Upload,
  SlidersHorizontal,
  AlertTriangle,
  Package,
  Coins,
} from "lucide-react";
import { useEnvironment } from "@/contexts/environment-context";
import { useWriteContract, useChainId } from "wagmi";
import { toast } from "sonner";
import { PlanFactoryABI, getContractAddresses, TOKENS } from "@meap/core";

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

// ─── Publish Summary Dialog ────────────────────────────────────────────────────

type ChainSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "NOT_APPLICABLE";

interface PublishedEntity {
  id: string;
  name: string;
  chainSyncStatus: ChainSyncStatus;
  onChainPlanId?: string | null;
  code?: string;
  tier?: string;
}

interface PublishResult {
  plans: PublishedEntity[];
  addOns: PublishedEntity[];
  credits: PublishedEntity[];
}

interface ChainSyncInfo {
  required: boolean;
  pendingCount: number;
  pendingPlanIds: string[];
  message: string;
}

function ChainSyncBadge({ status }: { status: ChainSyncStatus }) {
  if (status === "SYNCED")
    return <Badge variant="default" className="bg-green-600 text-white text-xs">On-chain</Badge>;
  if (status === "PENDING")
    return <Badge variant="secondary" className="text-yellow-600 border-yellow-400 text-xs">Needs sync</Badge>;
  if (status === "FAILED")
    return <Badge variant="destructive" className="text-xs">Sync failed</Badge>;
  return <Badge variant="outline" className="text-xs text-muted-foreground">Off-chain</Badge>;
}

function PublishButton({
  env,
  onPublished,
}: {
  env: EnvMode;
  onPublished: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [chainSync, setChainSync] = useState<ChainSyncInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handlePublish() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/catalog/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environmentMode: env }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data.published);
        setChainSync(data.chainSync ?? null);
        setOpen(true);
        onPublished();
      } else {
        setError(data.error ?? "Publish failed");
      }
    } finally {
      setLoading(false);
    }
  }

  const totalPublished =
    (result?.plans.length ?? 0) +
    (result?.addOns.length ?? 0) +
    (result?.credits.length ?? 0);

  return (
    <>
      <Button
        size="sm"
        onClick={handlePublish}
        disabled={loading}
        className="gap-2"
      >
        <Upload className="w-4 h-4" />
        {loading
          ? "Publishing…"
          : `Publish Drafts (${env === "DEVELOPMENT" ? "Dev" : "Prod"})`}
      </Button>
      {error && (
        <p className="text-xs text-destructive mt-1">{error}</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Catalog Published</DialogTitle>
            <DialogDescription>
              {totalPublished} item{totalPublished !== 1 ? "s" : ""} published to{" "}
              <strong>{env}</strong>.
            </DialogDescription>
          </DialogHeader>
          {result && (
            <div className="space-y-4 text-sm max-h-72 overflow-y-auto">
              {result.plans.length > 0 && (
                <div>
                  <p className="font-medium text-muted-foreground mb-1">Plans ({result.plans.length})</p>
                  <ul className="space-y-1">
                    {result.plans.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{p.name} <span className="text-muted-foreground">({p.tier})</span></span>
                        <ChainSyncBadge status={p.chainSyncStatus} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.addOns.length > 0 && (
                <div>
                  <p className="font-medium text-muted-foreground mb-1">Add-ons ({result.addOns.length})</p>
                  <ul className="space-y-1">
                    {result.addOns.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{a.name}</span>
                        <ChainSyncBadge status={a.chainSyncStatus} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.credits.length > 0 && (
                <div>
                  <p className="font-medium text-muted-foreground mb-1">Credit types ({result.credits.length})</p>
                  <ul className="space-y-1">
                    {result.credits.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2">
                        <span className="truncate">{c.name}</span>
                        <ChainSyncBadge status={c.chainSyncStatus} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {chainSync?.required && (
            <div className="rounded-md border border-yellow-400/30 bg-yellow-400/5 p-3 text-xs text-yellow-600 space-y-1">
              <p className="font-medium">{chainSync.pendingCount} plan(s) need on-chain registration</p>
              <p className="text-muted-foreground">{chainSync.message}</p>
            </div>
          )}
          <Button onClick={() => setOpen(false)}>Done</Button>
        </DialogContent>
      </Dialog>
    </>
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
  const [form, setForm] = useState({
    name: "",
    tier: "",
    description: "",
    price: "",
    billingInterval: "30",
    acceptedToken: "USDC",
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
      if (res.ok) {
        setOpen(false);
        setForm({
          name: "",
          tier: "",
          description: "",
          price: "",
          billingInterval: "30",
          acceptedToken: "USDC",
        });
        setErrors({});
        onCreated();
      } else {
        const data = await res.json();
        setErrors({ _global: data.error || "Failed to create plan" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2">
          <Plus className="w-4 h-4" />
          New Plan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Catalog Plan</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
            <Input
              value={form.acceptedToken}
              onChange={(e) =>
                setForm({ ...form, acceptedToken: e.target.value })
              }
              placeholder="USDC"
            />
            {errors.acceptedToken && (
              <p className="text-xs text-destructive">{errors.acceptedToken}</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Environment: <strong>{env}</strong> — plan will be created as DRAFT.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create Plan"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
    acceptedToken: "USDC",
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
          acceptedToken: "USDC",
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Create Add-On
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Add-On Product</DialogTitle>
          <DialogDescription>
            Add-ons are additional features or services customers can purchase
            alongside their plans. They work independently and don't require
            existing plans.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
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
            <Input
              id="addonToken"
              value={form.acceptedToken}
              onChange={(e) =>
                setForm({ ...form, acceptedToken: e.target.value })
              }
              placeholder="USDC"
              className="bg-secondary border-border focus:border-accent"
            />
            {errors.acceptedToken && (
              <p className="text-xs text-destructive">{errors.acceptedToken}</p>
            )}
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
            <span className="text-xs text-muted-foreground">
              Environment:{" "}
              <span className="text-foreground font-medium">{env}</span> —
              Add-on will be created as DRAFT and can be published later.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {loading ? "Creating…" : "Create Add-On"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
    acceptedToken: "USDC",
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
          acceptedToken: "USDC",
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="flex items-center gap-2 bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Create Credit Type
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Credit Type</DialogTitle>
          <DialogDescription>
            Credit types define units of consumption that can be granted through
            plans or purchased separately. Perfect for usage-based billing and
            metered features.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
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
              <Input
                id="creditToken"
                value={form.acceptedToken}
                onChange={(e) =>
                  setForm({ ...form, acceptedToken: e.target.value })
                }
                placeholder="USDC"
                className="bg-secondary border-border focus:border-accent"
              />
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
              Credit type will be created as DRAFT and can be published later.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-accent text-accent-foreground hover:bg-accent/90"
            >
              {loading ? "Creating…" : "Create Credit Type"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Plans Table ───────────────────────────────────────────────────────────────

function PlansTable({ env, refresh }: { env: EnvMode; refresh: number }) {
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [syncingPlanId, setSyncingPlanId] = useState<string | null>(null);
  const { writeContractAsync } = useWriteContract();
  const chainId = useChainId();

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
    setSyncingPlanId(plan.id);
    try {
      const contracts = getContractAddresses(chainId);
      const planFactoryAddress = contracts.planFactory as `0x${string}`;
      if (!planFactoryAddress || planFactoryAddress === "0x0000000000000000000000000000000000000000") {
        toast.error("PlanFactory not deployed on this chain");
        return;
      }
      const priceInUsdc = BigInt(Math.round(parseFloat(plan.price) * 1_000_000));
      const billingIntervalSeconds = plan.billingInterval * 86400;
      const usdcAddress = (
        TOKENS[chainId as keyof typeof TOKENS]?.USDC ?? plan.acceptedToken
      ) as `0x${string}`;
      const txHash = await writeContractAsync({
        address: planFactoryAddress,
        abi: PlanFactoryABI,
        functionName: "createPlan",
        args: [plan.name, plan.tier, priceInUsdc, billingIntervalSeconds, usdcAddress, ""],
      });
      await fetch("/api/catalog/chain-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, txHash, success: true }),
      });
      toast.success(`Plan registered on-chain: ${txHash.slice(0, 10)}…`);
      load();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Registration failed";
      await fetch("/api/catalog/chain-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: plan.id,
          txHash: "0x" + "0".repeat(64),
          success: false,
          errorMessage: message,
        }),
      }).catch(() => {});
      toast.error(message);
    } finally {
      setSyncingPlanId(null);
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
        <p className="text-sm text-muted-foreground py-4">Loading…</p>
      ) : plans.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No plans found. Create your first catalog plan above.
        </p>
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
                plan.status === "PUBLISHED" &&
                (plan.chainSyncStatus === "PENDING" || plan.chainSyncStatus === "FAILED");
              return (
                <TableRow key={plan.id}>
                  <TableCell className="font-medium">{plan.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {plan.tier}
                  </TableCell>
                  <TableCell>{parseFloat(plan.price).toFixed(2)}</TableCell>
                  <TableCell>{plan.billingInterval}d</TableCell>
                  <TableCell className="text-xs">
                    {plan.acceptedToken}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={plan.status} />
                  </TableCell>
                  <TableCell>
                    {plan.chainSyncStatus && plan.chainSyncStatus !== "NOT_APPLICABLE" ? (
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
                          disabled={updating === plan.id || syncingPlanId === plan.id}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {transitions.map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => updateStatus(plan.id, s)}
                          >
                            Mark as {s}
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

// ─── Add-Ons Table ─────────────────────────────────────────────────────────────

function AddOnsTable({ env, refresh }: { env: EnvMode; refresh: number }) {
  const [addOns, setAddOns] = useState<CatalogAddOn[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<CatalogStatus | "">("");
  const [updating, setUpdating] = useState<string | null>(null);

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
                    {addon.acceptedToken}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={addon.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    v{addon.version}
                  </TableCell>
                  <TableCell>
                    {transitions.length > 0 && (
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
                          {transitions.map((s) => (
                            <DropdownMenuItem
                              key={s}
                              onClick={() => updateStatus(addon.id, s)}
                            >
                              Mark as {s}
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
                  <TableCell className="text-xs">{ct.acceptedToken}</TableCell>
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
                              Mark as {s}
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

function ConfigurationTab() {
  const { envMode, setEnvMode } = useEnvironment();
  const [loadingEnv, setLoadingEnv] = useState(false);
  const [switchTarget, setSwitchTarget] = useState<EnvMode>("DEVELOPMENT");
  const [confirmText, setConfirmText] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchResult, setSwitchResult] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Configuration settings state
  const [settings, setSettings] = useState({
    // Initial Plan
    initialPlan: "Free",
    fallbackPlan: "none",

    // Component Display Settings
    showBillingPeriodToggle: true,
    freePlanPriceDisplay: true,
    hideCredits: false,
    yearlyDiscountDisplay: true,
    showFeatureDescriptions: true,
    showHardLimits: true,

    // Plan Change Rules
    upgradeImmediately: true,
    downgradeImmediately: false,
    preventDowngradeOverLimit: true,
    disallowSelfServiceDowngrade: false,
  });

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
      {/* Active Environment */}
      <div className="rounded-xl border border-border/50 bg-linear-to-br from-card to-card/50 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground tracking-tight">
              Active Environment
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Currently deployed network configuration
            </p>
          </div>
          <Badge
            variant="outline"
            className={`${envMode === "PRODUCTION" ? "border-orange-500/50 text-orange-500 bg-orange-500/10" : "border-blue-500/50 text-blue-500 bg-blue-500/10"} px-3.5 py-1.5 text-sm font-medium`}
          >
            {envMode === "PRODUCTION" ? "🟠 Mainnet" : "🔵 Testnet"}
          </Badge>
        </div>
        <div className="flex items-center gap-4 p-5 rounded-lg bg-secondary/60 border border-border/50">
          <div
            className={`w-5 h-5 rounded-full ${CHAIN_INFO[envMode].color} shrink-0 shadow-sm`}
          />
          <div className="flex-1">
            <p className="text-base font-semibold text-foreground">{envMode}</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              {CHAIN_INFO[envMode].name} · Chain ID{" "}
              <span className="font-mono font-medium">
                {CHAIN_INFO[envMode].chainId}
              </span>
            </p>
          </div>
        </div>
        {switchResult && (
          <div className="flex items-center gap-2.5 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
            <span className="text-sm font-medium text-green-600 dark:text-green-400">
              {switchResult}
            </span>
          </div>
        )}
      </div>

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
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="default"
                variant="outline"
                className="gap-2 h-11 px-6 hover:bg-secondary transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Switch Environment
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-xl">
                  Switch Environment
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Change the active environment mode for your team. This affects
                  which blockchain network your catalog data is published to.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSwitch} className="space-y-6">
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
            </DialogContent>
          </Dialog>
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
          <PublishButton env={envMode} onPublished={tr} />
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
          <PublishButton env={envMode} onPublished={tr} />
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
