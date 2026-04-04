"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Plus,
  Search,
  ToggleLeft,
  Activity,
  Tag,
  ChevronRight,
  Layers,
  ArrowLeft,
  Hash,
  Info,
  Pencil,
  Trash2,
  MoreHorizontal,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type FeatureType = "boolean" | "event" | "trait";

interface Feature {
  id: string;
  name: string;
  featureKey: string;
  description: string | null;
  featureType: FeatureType;
  eventKey: string | null;
  traitKey: string | null;
  linkedPlans: string[];
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FEATURE_TYPE_META: Record<
  FeatureType,
  { label: string; icon: React.ElementType; color: string; description: string }
> = {
  boolean: {
    label: "Boolean",
    icon: ToggleLeft,
    color: "text-blue-500",
    description: "Simple on/off access — is this feature enabled for the user?",
  },
  event: {
    label: "Event-based",
    icon: Activity,
    color: "text-violet-500",
    description:
      "Metered by event count — track usage and gate based on thresholds.",
  },
  trait: {
    label: "Trait-based",
    icon: Tag,
    color: "text-amber-500",
    description:
      "Determined by a company or user trait value stored on their profile.",
  },
};

const DEFAULT_FEATURE_TYPE_META = FEATURE_TYPE_META.boolean;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toFeatureKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function getFeatureTypeMeta(featureType: string | null | undefined) {
  return FEATURE_TYPE_META[featureType as FeatureType] ?? DEFAULT_FEATURE_TYPE_META;
}

// ─── Feature Detail View ─────────────────────────────────────────────────────

function FeatureDetailView({
  feature,
  onBack,
  onDelete,
}: {
  feature: Feature;
  onBack: () => void;
  onDelete: (id: string) => void;
}) {
  const meta = getFeatureTypeMeta(feature.featureType);
  const Icon = meta.icon;
  const [copied, setCopied] = useState(false);

  const copyKey = () => {
    void navigator.clipboard.writeText(feature.featureKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
      {/* Back + actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Features
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => {
                onDelete(feature.id);
                onBack();
              }}
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete Feature
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center bg-secondary border border-border shrink-0",
          )}
        >
          <Icon className={cn("w-6 h-6", meta.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-semibold text-foreground">
            {feature.name}
          </h2>
          {feature.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {feature.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge
              variant="secondary"
              className={cn("text-xs gap-1", meta.color)}
            >
              <Icon className="w-3 h-3" />
              {meta.label}
            </Badge>
            <button
              onClick={copyKey}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary border border-border text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              <Hash className="w-3 h-3" />
              {feature.featureKey}
              {copied ? (
                <Check className="w-3 h-3 text-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Type
          </p>
          <p className="text-sm font-medium text-foreground">{meta.label}</p>
          <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
        </div>

        {feature.featureType === "event" && feature.eventKey && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Event Key
            </p>
            <code className="text-sm font-mono text-foreground">
              {feature.eventKey}
            </code>
            <p className="text-xs text-muted-foreground mt-1">
              Tracked via <code className="font-mono">POST /api/v1/events</code>
            </p>
          </div>
        )}

        {feature.featureType === "trait" && feature.traitKey && (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Trait Key
            </p>
            <code className="text-sm font-mono text-foreground">
              {feature.traitKey}
            </code>
            <p className="text-xs text-muted-foreground mt-1">
              Read from company or user traits
            </p>
          </div>
        )}

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Linked Plans
          </p>
          {feature.linkedPlans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plans linked yet</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {feature.linkedPlans.map((plan) => (
                <Badge key={plan} variant="outline" className="text-xs">
                  <Layers className="w-3 h-3 mr-1" />
                  {plan}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Created
          </p>
          <p className="text-sm text-foreground">
            {new Date(feature.createdAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/20">
        <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Link this feature to a Flag for rule-based evaluation
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Go to <strong>Flags</strong> and create a flag using the key{" "}
            <code className="font-mono">{feature.featureKey}</code> to define
            who gets access based on plan, usage, or traits.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Create Feature Sheet ────────────────────────────────────────────────────

function CreateFeatureSheet({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (f: Feature) => void;
}) {
  const [form, setForm] = useState({
    name: "",
    featureKey: "",
    description: "",
    featureType: "boolean" as FeatureType,
    eventKey: "",
    traitKey: "",
    keyManuallyEdited: false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Auto-generate key from name unless user has manually edited it
  useEffect(() => {
    if (!form.keyManuallyEdited) {
      setForm((p) => ({ ...p, featureKey: toFeatureKey(p.name) }));
    }
  }, [form.name, form.keyManuallyEdited]);

  const reset = () => {
    setForm({
      name: "",
      featureKey: "",
      description: "",
      featureType: "boolean",
      eventKey: "",
      traitKey: "",
      keyManuallyEdited: false,
    });
    setError("");
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError("Feature name is required");
      return;
    }
    if (!form.featureKey.trim() || !/^[a-z0-9_]+$/.test(form.featureKey)) {
      setError("Feature key must be lowercase alphanumeric with underscores only");
      return;
    }
    if (form.featureType === "event" && !form.eventKey.trim()) {
      setError("Event key is required for event-based features");
      return;
    }
    if (form.featureType === "trait" && !form.traitKey.trim()) {
      setError("Trait key is required for trait-based features");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/v1/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          featureKey: form.featureKey,
          description: form.description || null,
          featureType: form.featureType,
          eventKey: form.featureType === "event" ? form.eventKey : null,
          traitKey: form.featureType === "trait" ? form.traitKey : null,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { feature: Feature };
        onCreate(data.feature);
        toast.success(`Feature "${form.name}" created`);
        reset();
        onOpenChange(false);
      } else {
        // Fallback: create locally for demo
        const newFeature: Feature = {
          id: `feat_${Math.random().toString(36).slice(2, 10)}`,
          name: form.name,
          featureKey: form.featureKey,
          description: form.description || null,
          featureType: form.featureType,
          eventKey: form.featureType === "event" ? form.eventKey : null,
          traitKey: form.featureType === "trait" ? form.traitKey : null,
          linkedPlans: [],
          createdAt: new Date().toISOString(),
        };
        onCreate(newFeature);
        toast.success(`Feature "${form.name}" created`);
        reset();
        onOpenChange(false);
      }
    } catch {
      // Offline / no backend — create locally
      const newFeature: Feature = {
        id: `feat_${Math.random().toString(36).slice(2, 10)}`,
        name: form.name,
        featureKey: form.featureKey,
        description: form.description || null,
        featureType: form.featureType,
        eventKey: form.featureType === "event" ? form.eventKey : null,
        traitKey: form.featureType === "trait" ? form.traitKey : null,
        linkedPlans: [],
        createdAt: new Date().toISOString(),
      };
      onCreate(newFeature);
      toast.success(`Feature "${form.name}" created`);
      reset();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const meta = getFeatureTypeMeta(form.featureType);
  const Icon = meta.icon;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent className="w-full sm:max-w-[420px] flex flex-col gap-0 p-0">
        <SheetHeader className="px-6 py-5 border-b border-border">
          <SheetTitle>Create feature</SheetTitle>
          <SheetDescription>
            Define a new feature capability for your product
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Feature type selector */}
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(FEATURE_TYPE_META) as [FeatureType, typeof FEATURE_TYPE_META[FeatureType]][]).map(
                ([type, typeMeta]) => {
                  const TypeIcon = typeMeta.icon;
                  const isSelected = form.featureType === type;
                  return (
                    <button
                      key={type}
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          featureType: type,
                          eventKey: "",
                          traitKey: "",
                        }))
                      }
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-3 rounded-xl border text-xs font-medium transition-all duration-150",
                        isSelected
                          ? "bg-accent/10 border-accent text-foreground"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:border-border/80",
                      )}
                    >
                      <TypeIcon
                        className={cn(
                          "w-5 h-5",
                          isSelected ? typeMeta.color : "",
                        )}
                      />
                      {typeMeta.label}
                    </button>
                  );
                },
              )}
            </div>
            <p className="text-xs text-muted-foreground">{meta.description}</p>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="feat-name">Feature name</Label>
            <Input
              id="feat-name"
              placeholder="e.g. AI Summary"
              value={form.name}
              onChange={(e) =>
                setForm((p) => ({ ...p, name: e.target.value }))
              }
              className="bg-secondary border-border"
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="feat-desc">
              Description{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Textarea
              id="feat-desc"
              placeholder="What does this feature do?"
              value={form.description}
              onChange={(e) =>
                setForm((p) => ({ ...p, description: e.target.value }))
              }
              className="bg-secondary border-border resize-none text-sm"
              rows={2}
            />
          </div>

          {/* Feature key */}
          <div className="space-y-2">
            <Label htmlFor="feat-key">
              Feature key{" "}
              <span className="text-muted-foreground font-normal text-xs">
                (used in SDK + flag rules)
              </span>
            </Label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                id="feat-key"
                placeholder="ai_summary"
                value={form.featureKey}
                onChange={(e) => {
                  const val = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9_]/g, "");
                  setForm((p) => ({
                    ...p,
                    featureKey: val,
                    keyManuallyEdited: true,
                  }));
                }}
                className="bg-secondary border-border font-mono text-sm pl-8"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Lowercase alphanumeric + underscores. Auto-generated from name.
            </p>
          </div>

          {/* Event key (event-based only) */}
          {form.featureType === "event" && (
            <div className="space-y-2">
              <Label htmlFor="feat-event-key">
                Event key{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (tracked event name)
                </span>
              </Label>
              <div className="relative">
                <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  id="feat-event-key"
                  placeholder="e.g. scan"
                  value={form.eventKey}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      eventKey: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                  className="bg-secondary border-border font-mono text-sm pl-8"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                The event name sent to{" "}
                <code className="font-mono">POST /api/v1/events</code>
              </p>
            </div>
          )}

          {/* Trait key (trait-based only) */}
          {form.featureType === "trait" && (
            <div className="space-y-2">
              <Label htmlFor="feat-trait-key">
                Trait key{" "}
                <span className="text-muted-foreground font-normal text-xs">
                  (company or user trait)
                </span>
              </Label>
              <div className="relative">
                <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  id="feat-trait-key"
                  placeholder="e.g. subscription_tier"
                  value={form.traitKey}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      traitKey: e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    }))
                  }
                  className="bg-secondary border-border font-mono text-sm pl-8"
                />
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border flex-row justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => { reset(); onOpenChange(false); }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            <Plus className="w-4 h-4 mr-1.5" />
            Create feature
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Main FeaturesSection ─────────────────────────────────────────────────────

export function FeaturesSection() {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FeatureType | "all">("all");
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/features");
      if (res.ok) {
        const data = (await res.json()) as { features: Feature[] };
        setFeatures(data.features ?? []);
      } else {
        // No backend yet — start with empty list
        setFeatures([]);
      }
    } catch {
      setFeatures([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`/api/v1/features/${id}`, { method: "DELETE" });
    } catch {
      // ignore
    }
    setFeatures((prev) => prev.filter((f) => f.id !== id));
    toast.success("Feature deleted");
  };

  const filtered = features.filter((f) => {
    const matchSearch =
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.featureKey.toLowerCase().includes(searchQuery.toLowerCase());
    const matchType = typeFilter === "all" || f.featureType === typeFilter;
    return matchSearch && matchType;
  });

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selectedFeature) {
    return (
      <FeatureDetailView
        feature={selectedFeature}
        onBack={() => setSelectedFeature(null)}
        onDelete={handleDelete}
      />
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Define the capabilities your product offers — Boolean, Event-based, or Trait-based.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create feature
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search features…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-56 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
        <div className="flex items-center gap-2">
          {(["all", "boolean", "event", "trait"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 capitalize",
                typeFilter === t
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all"
                ? "All"
                : t === "event"
                  ? "Event-based"
                  : t === "trait"
                    ? "Trait-based"
                    : "Boolean"}
            </button>
          ))}
        </div>
      </div>

      {/* Feature list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Feature
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Type
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                  Linked Plans
                </th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                  Created
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {Array.from({ length: 4 }).map((__, j) => (
                      <td key={j} className="py-3 px-4">
                        <div className="h-4 bg-secondary/80 rounded animate-pulse w-24" />
                      </td>
                    ))}
                    <td />
                  </tr>
                ))}

              {!loading &&
                filtered.map((feature, index) => {
                  const meta = getFeatureTypeMeta(feature.featureType);
                  const Icon = meta.icon;
                  return (
                    <tr
                      key={feature.id}
                      className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer animate-in fade-in slide-in-from-left-2"
                      style={{
                        animationDelay: `${index * 40}ms`,
                        animationFillMode: "both",
                      }}
                      onClick={() => setSelectedFeature(feature)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0">
                            <Icon className={cn("w-4 h-4", meta.color)} />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {feature.name}
                            </p>
                            <code className="text-xs text-muted-foreground font-mono">
                              {feature.featureKey}
                            </code>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant="secondary"
                          className={cn("text-xs gap-1", meta.color)}
                        >
                          <Icon className="w-3 h-3" />
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 hidden sm:table-cell">
                        {feature.linkedPlans.length === 0 ? (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {feature.linkedPlans.slice(0, 2).map((plan) => (
                              <Badge
                                key={plan}
                                variant="outline"
                                className="text-xs"
                              >
                                {plan}
                              </Badge>
                            ))}
                            {feature.linkedPlans.length > 2 && (
                              <Badge variant="outline" className="text-xs">
                                +{feature.linkedPlans.length - 2}
                              </Badge>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 hidden md:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {new Date(feature.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
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
              <ToggleLeft className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {searchQuery || typeFilter !== "all"
                ? "No features match your filter"
                : "No features defined yet"}
            </p>
            <p className="text-xs text-muted-foreground max-w-[300px] mb-4">
              Features define the capabilities your product offers. Create your first feature to get started.
            </p>
            {!searchQuery && typeFilter === "all" && (
              <Button onClick={() => setShowCreate(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Create your first feature
              </Button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/30">
          <span className="text-sm text-muted-foreground">
            {filtered.length} feature{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Create sheet */}
      <CreateFeatureSheet
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreate={(f) => setFeatures((prev) => [f, ...prev])}
      />
    </div>
  );
}
