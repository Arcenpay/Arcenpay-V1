"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Plus,
  Flag,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Search,
  Info,
  Hash,
  Type,
  ToggleLeft as BoolIcon,
  AlertCircle,
  RefreshCw,
  Database,
  ExternalLink,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccount } from "wagmi";
import { toast } from "sonner";

type FlagType = "boolean" | "string" | "number";

interface FeatureFlag {
  key: string;
  label: string;
  description?: string;
  type: FlagType;
  planTiers: string[];
  enabledCount: number;
  totalCount: number;
}

const FLAG_TYPE_ICONS: Record<FlagType, React.ElementType> = {
  boolean: BoolIcon,
  string: Type,
  number: Hash,
};

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error(
        "Wallet not linked. Please visit Settings to link your wallet to your account.",
      );
    }
    if (res.status === 503 || res.status === 504) {
      throw new Error(
        "Facilitator service is unavailable. Make sure it is running.",
      );
    }
    const text = await res.text().catch(() => "");
    let message = `HTTP ${res.status}`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      message = text || message;
    }
    throw new Error(message);
  }
  return res.json();
}

export function FeaturesSection() {
  const router = useRouter();
  const { address, isConnected } = useAccount();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [planTiers, setPlanTiers] = useState<string[]>([
    "starter",
    "pro",
    "enterprise",
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableExists, setTableExists] = useState<boolean | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<string>("All");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newFlag, setNewFlag] = useState({
    key: "",
    label: "",
    description: "",
    type: "boolean" as FlagType,
    defaultValue: "",
    planTiers: [] as string[],
  });
  const [newFlagError, setNewFlagError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  const fetchFlags = useCallback(async () => {
    if (!isConnected || !address) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(
        `/api/entitlements/provider/${address}/flags`,
      );
      setFlags(data.flags ?? []);
      setTableExists(data.storageReady ?? true);
      if (data.planTiers) setPlanTiers(data.planTiers);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to load feature flags";
      setError(msg);
      setFlags([]);
      setTableExists(null);
    } finally {
      setLoading(false);
    }
  }, [address, isConnected]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  // Auto-bootstrap entitlement storage on first load when Tableland is configured
  // but the provider's flag table doesn't exist yet (storageReady === false).
  useEffect(() => {
    if (tableExists !== false || !isConnected || !address || isBootstrapping)
      return;
    setIsBootstrapping(true);
    apiFetch(`/api/entitlements/provider/${address}/flags/bootstrap`, {
      method: "POST",
    })
      .then(() => {
        setTableExists(true);
        void fetchFlags();
      })
      .catch(() => {
        // Bootstrap silently fails when Tableland isn't configured server-side.
        // Set tableExists to null (not false) so this effect doesn't re-trigger
        // on every render — the manual "Initialize Storage" button stays visible.
        setTableExists(null);
      })
      .finally(() => setIsBootstrapping(false));
  }, [tableExists, isConnected, address, isBootstrapping, fetchFlags]);

  const handleDeployTable = async () => {
    setIsSaving(true);
    try {
      await apiFetch(`/api/entitlements/provider/${address}/flags/bootstrap`, {
        method: "POST",
      });
      setTableExists(true);
      toast.success("Entitlement storage initialized");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to initialize storage",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFlag = async () => {
    if (!newFlag.key.trim()) {
      setNewFlagError("Key is required");
      return;
    }
    if (!/^[a-z0-9_]+$/.test(newFlag.key)) {
      setNewFlagError(
        "Key must be lowercase alphanumeric with underscores only",
      );
      return;
    }
    if (flags.some((f) => f.key === newFlag.key)) {
      setNewFlagError("A flag with this key already exists");
      return;
    }

    const flagData: FeatureFlag = {
      key: newFlag.key,
      label: newFlag.label || newFlag.key,
      description: newFlag.description,
      type: newFlag.type,
      planTiers: newFlag.planTiers,
      enabledCount: 0,
      totalCount: 0,
    };

    setIsSaving(true);
    try {
      await apiFetch(
        `/api/entitlements/provider/${address}/flags/${flagData.key}`,
        {
          method: "PUT",
          body: JSON.stringify({
            label: flagData.label,
            description: flagData.description,
            type: flagData.type,
            planTiers: flagData.planTiers,
          }),
        },
      );
      setFlags((prev) => [
        ...prev.filter((f) => f.key !== flagData.key),
        flagData,
      ]);
      toast.success(`Flag "${flagData.key}" created`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : `Failed to create "${flagData.key}"`;
      toast.error(msg);
      return;
    } finally {
      setIsSaving(false);
    }

    setNewFlag({
      key: "",
      label: "",
      description: "",
      type: "boolean",
      defaultValue: "",
      planTiers: [] as string[],
    });
    setNewFlagError("");
    setShowAddDialog(false);
  };

  const handleDeleteFlag = async (key: string) => {
    try {
      await apiFetch(`/api/entitlements/provider/${address}/flags/${key}`, {
        method: "DELETE",
      });
      setFlags((prev) => prev.filter((f) => f.key !== key));
      toast.success(`Flag "${key}" deleted`);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : `Failed to delete "${key}"`;
      toast.error(msg);
    }
  };

  const handleBulkToggle = async (
    enable: boolean,
    flagKey: string,
    tier: string,
  ) => {
    try {
      await apiFetch(`/api/entitlements/provider/${address}/flags/${flagKey}`, {
        method: "PATCH",
        body: JSON.stringify({
          tier: tier.toLowerCase(),
          enabled: enable,
        }),
      });
      toast.success(
        `${enable ? "Enabled" : "Disabled"} "${flagKey}" for ${tier} tier`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Bulk operation failed");
    }
  };

  const toggleTierForNewFlag = (tier: string) => {
    setNewFlag((prev) => ({
      ...prev,
      planTiers: prev.planTiers.includes(tier)
        ? prev.planTiers.filter((t) => t !== tier)
        : [...prev.planTiers, tier],
    }));
  };

  const filtered = flags.filter((f) => {
    const matchesSearch =
      f.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.label.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier =
      selectedTier === "All" || f.planTiers.includes(selectedTier);
    return matchesSearch && matchesTier;
  });

  const [bulkFlagKey, setBulkFlagKey] = useState("");
  const [bulkTier, setBulkTier] = useState("");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Manage entitlement feature flags served by the facilitator.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isBootstrapping && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              Setting up storage…
            </span>
          )}
          {tableExists === false && !isBootstrapping && (
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={handleDeployTable}
              disabled={isSaving || !isConnected}
            >
              <Database className="w-4 h-4" />
              Initialize Storage
            </Button>
          )}
          <Button
            className="flex items-center gap-2"
            onClick={() => setShowAddDialog(true)}
            disabled={!isConnected}
          >
            <Plus className="w-4 h-4" />
            Add Feature Flag
          </Button>
        </div>
      </div>

      {/* Info Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Feature flags are persisted by facilitator storage and enforced by
            your entitlement checks.
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Each flag can be toggled by plan tier. Connect your wallet to
            configure provider-level gating rules.
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-warning/5 border border-warning/20">
          <AlertCircle className="w-4 h-4 text-warning shrink-0" />
          <p className="text-sm text-muted-foreground flex-1">{error}</p>
          <div className="flex items-center gap-2">
            {error.includes("Wallet not linked") ? (
              <Button
                variant="default"
                size="sm"
                onClick={() => router.push("/onboarding/wallet")}
                className="gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Link Wallet
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={fetchFlags}>
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search flags…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-2">
          {["All", ...planTiers].map((tier) => (
            <button
              key={tier}
              onClick={() => setSelectedTier(tier)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200",
                selectedTier === tier
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {tier}
            </button>
          ))}
        </div>
      </div>

      {/* Flags Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Feature Key
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Type
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Plan Tiers
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Subscribers
                </th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="py-3 px-4">
                        <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                      </td>
                    ))}
                    <td className="py-3 px-4" />
                  </tr>
                ))}
              {!loading &&
                filtered.map((flag, index) => {
                  const TypeIcon = FLAG_TYPE_ICONS[flag.type];
                  return (
                    <tr
                      key={flag.key}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors animate-in fade-in slide-in-from-left-2"
                      style={{
                        animationDelay: `${index * 40}ms`,
                        animationFillMode: "both",
                      }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Flag className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5 self-start" />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {flag.label}
                            </p>
                            <code className="text-xs text-muted-foreground font-mono">
                              {flag.key}
                            </code>
                            {flag.description && (
                              <p className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">
                                {flag.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <TypeIcon className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground capitalize">
                            {flag.type}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          {flag.planTiers.length === 0 ? (
                            <span className="text-xs text-muted-foreground">
                              None
                            </span>
                          ) : (
                            flag.planTiers.map((tier) => (
                              <Badge
                                key={tier}
                                variant="secondary"
                                className="text-xs"
                              >
                                {tier}
                              </Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground">
                          {flag.enabledCount}/{flag.totalCount}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            title="Delete flag"
                            onClick={() => handleDeleteFlag(flag.key)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-4">
              <Flag className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {!isConnected
                ? "Connect your wallet"
                : searchQuery || selectedTier !== "All"
                  ? "No flags match your filter"
                  : "No feature flags defined yet"}
            </p>
            <p className="text-xs text-muted-foreground max-w-[320px] mb-4">
              Add feature flags to gate access to premium features using
              Tableland + Lit Protocol
            </p>
            {!searchQuery && selectedTier === "All" && isConnected && (
              <Button
                className="flex items-center gap-2"
                onClick={() => setShowAddDialog(true)}
              >
                <Plus className="w-4 h-4" />
                Add Your First Flag
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            Showing {filtered.length} flag{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Bulk Operations Card */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-base font-medium">
            Bulk Operations
          </CardTitle>
          <CardDescription>
            Enable or disable a feature flag across all subscribers in a plan
            tier
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <Select value={bulkFlagKey} onValueChange={setBulkFlagKey}>
              <SelectTrigger className="w-40 bg-secondary border-border">
                <SelectValue placeholder="Select flag" />
              </SelectTrigger>
              <SelectContent>
                {flags.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={bulkTier} onValueChange={setBulkTier}>
              <SelectTrigger className="w-40 bg-secondary border-border">
                <SelectValue placeholder="Select tier" />
              </SelectTrigger>
              <SelectContent>
                {planTiers.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="border-border"
                disabled={!bulkFlagKey || !bulkTier || !isConnected}
                onClick={() => handleBulkToggle(true, bulkFlagKey, bulkTier)}
              >
                <ToggleRight className="w-4 h-4 mr-2 text-success" />
                Enable All
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="border-border"
                disabled={!bulkFlagKey || !bulkTier || !isConnected}
                onClick={() => handleBulkToggle(false, bulkFlagKey, bulkTier)}
              >
                <ToggleLeft className="w-4 h-4 mr-2 text-muted-foreground" />
                Disable All
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Flag Sheet */}
      <Sheet open={showAddDialog} onOpenChange={setShowAddDialog}>
        <SheetContent className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <SheetHeader className="pb-4 border-b border-border">
            <SheetTitle>Add Feature Flag</SheetTitle>
            <SheetDescription>
              Define a new cryptographic feature flag stored on Tableland
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="flagKey">Flag Key</Label>
              <Input
                id="flagKey"
                placeholder="e.g. advanced_analytics"
                value={newFlag.key}
                onChange={(e) => {
                  setNewFlag((p) => ({
                    ...p,
                    key: e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9_]/g, "_"),
                  }));
                  setNewFlagError("");
                }}
                className="bg-secondary border-border font-mono text-sm"
              />
              {newFlagError && (
                <p className="text-xs text-destructive">{newFlagError}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Lowercase alphanumeric and underscores only
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flagLabel">Display Label</Label>
              <Input
                id="flagLabel"
                placeholder="e.g. Advanced Analytics"
                value={newFlag.label}
                onChange={(e) =>
                  setNewFlag((p) => ({ ...p, label: e.target.value }))
                }
                className="bg-secondary border-border"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="flagDescription">
                Description{" "}
                <span className="text-muted-foreground font-normal">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="flagDescription"
                placeholder="Describe what this flag controls, e.g. Enables advanced analytics dashboard for subscribers on this tier."
                value={newFlag.description}
                onChange={(e) =>
                  setNewFlag((p) => ({ ...p, description: e.target.value }))
                }
                className="bg-secondary border-border resize-none text-sm"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label>Value Type</Label>
              <div className="flex items-center gap-2">
                {(["boolean", "string", "number"] as FlagType[]).map((t) => {
                  const Icon = FLAG_TYPE_ICONS[t];
                  return (
                    <button
                      key={t}
                      onClick={() => setNewFlag((p) => ({ ...p, type: t }))}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200",
                        newFlag.type === t
                          ? "bg-accent text-accent-foreground border-accent"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>

            {newFlag.type !== "boolean" && (
              <div className="space-y-2">
                <Label htmlFor="flagDefault">
                  Default Value{" "}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </Label>
                <Input
                  id="flagDefault"
                  type={newFlag.type === "number" ? "number" : "text"}
                  placeholder={
                    newFlag.type === "number" ? "e.g. 100" : "e.g. standard"
                  }
                  value={newFlag.defaultValue}
                  onChange={(e) =>
                    setNewFlag((p) => ({ ...p, defaultValue: e.target.value }))
                  }
                  className="bg-secondary border-border"
                />
                <p className="text-xs text-muted-foreground">
                  Applied to tiers where the flag is enabled
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Assign to Plan Tiers</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {planTiers.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => toggleTierForNewFlag(tier)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200",
                      newFlag.planTiers.includes(tier)
                        ? "bg-accent text-accent-foreground border-accent"
                        : "bg-secondary border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <SheetFooter className="pt-4 border-t border-border flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddFlag} disabled={isSaving}>
              <Plus className="w-4 h-4 mr-2" />
              Add Flag
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
