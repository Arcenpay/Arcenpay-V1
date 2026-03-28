"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Flag, Plus, RefreshCw, Trash2, GripVertical, Check, X,
  Zap, Shield, ChevronRight, Settings2, Info, ArrowLeft,
  MoreHorizontal, Copy, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlagCondition {
  id: string;
  criteriaType: string;
  operator: string;
  values: unknown[];
  metricKey: string | null;
  metricValue: number | null;
  metricPeriod: string | null;
  traitKey: string | null;
  zktlsProviderId: string | null;
}

interface FlagRule {
  id: string;
  priority: number;
  value: boolean;
  conditions: FlagCondition[];
}

interface FeatureFlag {
  id: string;
  featureKey: string;
  name: string;
  description: string | null;
  featureType: string;
  eventKey: string | null;
  defaultValue: boolean;
  createdAt: string;
  rules: FlagRule[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CRITERIA_TYPES = [
  { value: "base_plan",     label: "Base Plan" },
  { value: "add_on",        label: "Add-On" },
  { value: "usage",         label: "Usage (Event Count)" },
  { value: "company_trait", label: "Company Trait" },
  { value: "user_trait",    label: "User Trait" },
  { value: "zktls_claim",   label: "zkTLS Claim (Reclaim)" },
];

const OPERATORS_BY_CRITERIA: Record<string, { value: string; label: string }[]> = {
  base_plan:     [{ value: "is_one_of", label: "is one of" }, { value: "is_not_one_of", label: "is not one of" }],
  add_on:        [{ value: "is_one_of", label: "is one of" }, { value: "is_not_one_of", label: "is not one of" }],
  usage:         [{ value: "is_less_than", label: "< less than" }, { value: "is_greater_than", label: "> greater than" }],
  company_trait: [{ value: "equals", label: "equals" }, { value: "not_equals", label: "not equals" }, { value: "contains", label: "contains" }, { value: "is_one_of", label: "is one of" }],
  user_trait:    [{ value: "equals", label: "equals" }, { value: "not_equals", label: "not equals" }, { value: "contains", label: "contains" }],
  zktls_claim:   [{ value: "exists", label: "proof exists" }],
};

// ─── ConditionEditor ──────────────────────────────────────────────────────────

interface CatalogPlanOption { id: string; name: string; tier: string; }
interface CatalogAddOnOption { id: string; name: string; }

function ConditionEditor({ condition, onChange, onDelete }: {
  condition: Partial<FlagCondition>;
  onChange: (c: Partial<FlagCondition>) => void;
  onDelete: () => void;
}) {
  const type = condition.criteriaType ?? "base_plan";
  const ops  = OPERATORS_BY_CRITERIA[type] ?? [];

  const [plans, setPlans] = useState<CatalogPlanOption[]>([]);
  const [addOns, setAddOns] = useState<CatalogAddOnOption[]>([]);

  useEffect(() => {
    if (type === "base_plan") {
      fetch("/api/catalog/plans?status=PUBLISHED")
        .then((r) => r.json())
        .then((d) => {
          const items = (d?.data ?? d?.plans ?? []) as CatalogPlanOption[];
          setPlans(items);
        })
        .catch(() => {});
    }
    if (type === "add_on") {
      fetch("/api/catalog/add-ons")
        .then((r) => r.json())
        .then((d) => {
          const items = (d?.data ?? d?.addOns ?? []) as CatalogAddOnOption[];
          setAddOns(items);
        })
        .catch(() => {});
    }
  }, [type]);

  const selectedValues = (condition.values as string[]) ?? [];

  function toggleOption(id: string) {
    const next = selectedValues.includes(id)
      ? selectedValues.filter((v) => v !== id)
      : [...selectedValues, id];
    onChange({ ...condition, values: next });
  }

  const selectCls = "h-8 text-xs border-border bg-background rounded-md px-2 w-full focus:ring-1 focus:ring-ring";

  return (
    <div className="flex gap-2 p-2.5 bg-muted/40 rounded-lg border border-border/60 group">
      <div className="flex-1 grid grid-cols-2 gap-2">
        {/* Criteria type */}
        <select
          value={type}
          onChange={(e) => onChange({ ...condition, criteriaType: e.target.value, operator: OPERATORS_BY_CRITERIA[e.target.value]?.[0]?.value ?? "equals" })}
          className={selectCls}
        >
          {CRITERIA_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
        </select>

        {/* Operator */}
        <select
          value={condition.operator ?? ops[0]?.value ?? "equals"}
          onChange={(e) => onChange({ ...condition, operator: e.target.value })}
          className={selectCls}
        >
          {ops.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
        </select>

        {/* Usage-specific fields */}
        {type === "usage" && (
          <>
            <input type="text" placeholder="Event key (e.g., scan)"
              value={condition.metricKey ?? ""}
              onChange={(e) => onChange({ ...condition, metricKey: e.target.value })}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
            <input type="number" placeholder="Threshold"
              value={condition.metricValue ?? ""}
              onChange={(e) => onChange({ ...condition, metricValue: Number(e.target.value) })}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
            <select value={condition.metricPeriod ?? "monthly"}
              onChange={(e) => onChange({ ...condition, metricPeriod: e.target.value })}
              className={`col-span-2 ${selectCls}`}>
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </>
        )}

        {/* Trait fields */}
        {(type === "company_trait" || type === "user_trait") && (
          <>
            <input type="text" placeholder="Trait key (e.g., plan_tier)"
              value={condition.traitKey ?? ""}
              onChange={(e) => onChange({ ...condition, traitKey: e.target.value })}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
            <input type="text" placeholder="Value (comma-separated)"
              value={(condition.values as string[])?.join(",") ?? ""}
              onChange={(e) => onChange({ ...condition, values: e.target.value.split(",").map((v) => v.trim()) })}
              className="h-8 text-xs border border-border rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring" />
          </>
        )}

        {/* zkTLS */}
        {type === "zktls_claim" && (
          <input type="text" placeholder="Reclaim Provider ID"
            value={condition.zktlsProviderId ?? ""}
            onChange={(e) => onChange({ ...condition, zktlsProviderId: e.target.value })}
            className="col-span-2 h-8 text-xs border border-border rounded-md px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
        )}

        {/* Plan picker */}
        {type === "base_plan" && (
          <div className="col-span-2 space-y-1">
            {plans.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No published plans found</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {plans.map((p) => {
                  const selected = selectedValues.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleOption(p.id)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:border-primary/60"
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {p.name}
                      <span className="opacity-60">· {p.tier}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {selectedValues.length === 0 && (
              <p className="text-xs text-destructive/70">Select at least one plan</p>
            )}
          </div>
        )}

        {/* Add-on picker */}
        {type === "add_on" && (
          <div className="col-span-2 space-y-1">
            {addOns.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No add-ons found</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {addOns.map((a) => {
                  const selected = selectedValues.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleOption(a.id)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border transition-colors ${
                        selected
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:border-primary/60"
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                      {a.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <button onClick={onDelete} className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 flex-shrink-0">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── RuleEditor ───────────────────────────────────────────────────────────────

function RuleEditor({ rule, index, onChange, onDelete }: {
  rule: Partial<FlagRule> & { conditions: Partial<FlagCondition>[] };
  index: number;
  onChange: (r: typeof rule) => void;
  onDelete: () => void;
}) {
  const addCondition = () => {
    onChange({
      ...rule,
      conditions: [...rule.conditions, { criteriaType: "base_plan", operator: "is_one_of", values: [] }] as unknown as FlagCondition[],
    });
  };

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm overflow-hidden">
      {/* Rule header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <GripVertical className="h-4 w-4 text-muted-foreground/50 cursor-grab" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Rule {index + 1}</span>
          <span className="text-xs text-muted-foreground">— if all match, serve:</span>
          <div className="flex gap-1">
            <button onClick={() => onChange({ ...rule, value: true })}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${rule.value ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/40 dark:text-emerald-400" : "border-border text-muted-foreground hover:border-emerald-400/50"}`}>
              True
            </button>
            <button onClick={() => onChange({ ...rule, value: false })}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${!rule.value ? "bg-destructive/15 text-destructive border-destructive/40" : "border-border text-muted-foreground hover:border-destructive/40"}`}>
              False
            </button>
          </div>
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-destructive/10">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Conditions */}
      <div className="p-3 space-y-2">
        {rule.conditions.length === 0 ? (
          <p className="text-xs text-muted-foreground py-1">No conditions — this rule always matches. Add a condition below.</p>
        ) : (
          rule.conditions.map((cond, ci) => (
            <ConditionEditor
              key={ci}
              condition={cond}
              onChange={(updated) => {
                const newConds = [...rule.conditions] as unknown as FlagCondition[];
                newConds[ci] = updated as unknown as FlagCondition;
                onChange({ ...rule, conditions: newConds });
              }}
              onDelete={() => onChange({ ...rule, conditions: rule.conditions.filter((_, i) => i !== ci) })}
            />
          ))
        )}
        <button onClick={addCondition}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted/50 border border-dashed border-border/60 w-full justify-center">
          <Plus className="h-3 w-3" /> Add Condition
        </button>
      </div>
    </div>
  );
}

// ─── FlagDetailSheet ──────────────────────────────────────────────────────────

function FlagDetailSheet({ flag, open, onClose, onSaved }: {
  flag: FeatureFlag | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rules, setRules] = useState<(Partial<FlagRule> & { conditions: Partial<FlagCondition>[] })[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (flag) setRules(flag.rules.map((r) => ({ ...r })));
  }, [flag]);

  const saveRules = async () => {
    if (!flag) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/feature-flags/${flag.id}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules.map((r, i) => ({ ...r, priority: i })) }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { setSaved(false); onSaved(); }, 1500);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!flag) return null;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-2xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <div className="flex items-center gap-2 flex-wrap">
            <Flag className="h-4 w-4 text-primary flex-shrink-0" />
            <SheetTitle className="text-base">{flag.name}</SheetTitle>
            <Badge variant="outline" className="font-mono text-xs">{flag.featureKey}</Badge>
            {flag.featureType === "event_based" && (
              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs dark:text-blue-400">
                <Zap className="h-3 w-3 mr-1" /> {flag.eventKey}
              </Badge>
            )}
            {flag.featureType === "zktls" && (
              <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/30 text-xs dark:text-purple-400">
                <Shield className="h-3 w-3 mr-1" /> zkTLS
              </Badge>
            )}
          </div>
          <SheetDescription>
            Rules are evaluated top-to-bottom. First match wins. Company overrides always take priority.
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {rules.map((rule, i) => (
            <RuleEditor
              key={i}
              rule={rule}
              index={i}
              onChange={(updated) => {
                const next = [...rules];
                next[i] = updated;
                setRules(next);
              }}
              onDelete={() => setRules(rules.filter((_, idx) => idx !== i))}
            />
          ))}

          {/* Default catch-all */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-border/60 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Default (ELSE)</span>
              <span className="text-xs text-muted-foreground">— no rules matched</span>
            </div>
            <Badge variant={flag.defaultValue ? "default" : "outline"} className="text-xs">
              {flag.defaultValue ? "True" : "False"}
            </Badge>
          </div>

          <button
            onClick={() => setRules([...rules, { priority: rules.length, value: true, conditions: [] }])}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-3 rounded-xl border border-dashed border-border/50 w-full justify-center hover:bg-muted/30 hover:border-border">
            <Plus className="h-4 w-4" /> Add Rule
          </button>
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
          <Button variant="outline" size="sm" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button size="sm" onClick={saveRules} disabled={saving} className="flex-1">
            {saving ? (
              <span className="flex items-center gap-1.5"><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Saving…</span>
            ) : saved ? (
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> Saved</span>
            ) : (
              "Save Rules"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── CreateFlagSheet ──────────────────────────────────────────────────────────

function CreateFlagSheet({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ featureKey: "", name: "", featureType: "boolean", eventKey: "", description: "" });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setForm({ featureKey: "", name: "", featureType: "boolean", eventKey: "", description: "" }); setError(""); };

  const handleCreate = async () => {
    if (!form.featureKey || !form.name) return;
    setCreating(true);
    setError("");
    try {
      const res = await fetch("/api/v1/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        reset();
        onOpenChange(false);
        onCreated();
      } else {
        const body = await res.json() as { error?: string };
        setError(body.error ?? "Failed to create flag");
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <SheetContent side="right" className="sm:max-w-md flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <SheetTitle>Create Feature Flag</SheetTitle>
          <SheetDescription>
            Define a new feature flag with targeting rules evaluated per-company in real time.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="flag-name">Name <span className="text-destructive">*</span></Label>
            <Input
              id="flag-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, featureKey: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") })}
              placeholder="AI Summary"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flag-key">
              Feature Key <span className="text-destructive">*</span>
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">(used in API calls)</span>
            </Label>
            <Input
              id="flag-key"
              value={form.featureKey}
              onChange={(e) => setForm({ ...form, featureKey: e.target.value })}
              placeholder="ai_summary"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">Lowercase, letters, numbers, underscores and hyphens only.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="flag-desc">Description</Label>
            <Input
              id="flag-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Feature Type</Label>
            <Select value={form.featureType} onValueChange={(v) => setForm({ ...form, featureType: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boolean">Boolean — simple on/off flag</SelectItem>
                <SelectItem value="event_based">Event-based — tracks usage count</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.featureType === "event_based" && (
            <div className="space-y-1.5">
              <Label htmlFor="event-key">Event Key</Label>
              <Input
                id="event-key"
                value={form.eventKey}
                onChange={(e) => setForm({ ...form, eventKey: e.target.value })}
                placeholder="scan"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Matches the <code className="bg-muted px-1 py-0.5 rounded text-[10px]">name</code> field of tracked events.</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>

        <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={creating || !form.featureKey.trim() || !form.name.trim()}
            className="flex-1"
          >
            {creating ? <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Creating…</> : "Create Flag"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ─── Feature type badge ───────────────────────────────────────────────────────

function TypeBadge({ flag }: { flag: FeatureFlag }) {
  if (flag.featureType === "event_based") {
    return (
      <Badge className="bg-blue-500/10 text-blue-600 border border-blue-500/30 text-xs dark:text-blue-400 gap-1">
        <Zap className="h-3 w-3" /> Event
      </Badge>
    );
  }
  if (flag.featureType === "zktls") {
    return (
      <Badge className="bg-purple-500/10 text-purple-600 border border-purple-500/30 text-xs dark:text-purple-400 gap-1">
        <Shield className="h-3 w-3" /> zkTLS
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs">Boolean</Badge>;
}

// ─── Flag Detail View ──────────────────────────────────────────────────────────

function FlagDetailView({
  flag,
  onBack,
  onSaved,
}: {
  flag: FeatureFlag;
  onBack: () => void;
  onSaved: () => void;
}) {
  const [detailTab, setDetailTab] = useState<"rules" | "companies">("rules");
  const [rules, setRules] = useState<(Partial<FlagRule> & { conditions: Partial<FlagCondition>[] })[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Initialize rules from flag
  useState(() => {
    setRules(flag.rules.map((r) => ({ ...r })));
  });

  // Re-sync when flag changes
  useEffect(() => {
    setRules(flag.rules.map((r) => ({ ...r })));
  }, [flag]);

  const saveRules = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/feature-flags/${flag.id}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules.map((r, i) => ({ ...r, priority: i })) }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { setSaved(false); onSaved(); }, 1500);
      }
    } finally {
      setSaving(false);
    }
  };

  function copyKey() {
    navigator.clipboard.writeText(flag.featureKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  }

  const DETAIL_TABS = ["rules", "companies"] as const;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button
          onClick={onBack}
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          FEATURE FLAGS
        </button>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium">{flag.name}</span>
      </div>

      {/* Flag header card */}
      <div className="bg-card border border-border rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          {/* Left: icon + name + key */}
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground leading-tight">{flag.name}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                <code className="text-xs font-mono text-muted-foreground">{flag.featureKey}</code>
                <button onClick={copyKey} className="text-muted-foreground hover:text-foreground transition-colors">
                  {copiedKey ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>

          {/* Right: type badge + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <TypeBadge flag={flag} />
            <Badge
              variant={flag.defaultValue ? "default" : "outline"}
              className={`text-xs ${flag.defaultValue ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400" : ""}`}
            >
              Default: {flag.defaultValue ? "True" : "False"}
            </Badge>
            <div className="h-6 w-px bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={saveRules} disabled={saving} className="gap-1.5">
                {saving ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Saving…</>
                ) : saved ? (
                  <><Check className="w-3.5 h-3.5 text-green-500" />Saved</>
                ) : (
                  "Save Rules"
                )}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={copyKey}>
                    {copiedKey ? (
                      <><Check className="w-3.5 h-3.5 mr-2 text-green-500" />Copied!</>
                    ) : (
                      <><Copy className="w-3.5 h-3.5 mr-2" />Copy Feature Key</>
                    )}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* Description */}
      {flag.description && (
        <p className="text-sm text-muted-foreground -mt-2">{flag.description}</p>
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
              {tab === "rules" && rules.length > 0 && (
                <span className="ml-2 text-xs bg-secondary rounded-full px-1.5 py-0.5">
                  {rules.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Rules tab */}
      {detailTab === "rules" && (
        <div className="space-y-3">
          {rules.map((rule, i) => (
            <RuleEditor
              key={i}
              rule={rule}
              index={i}
              onChange={(updated) => {
                const next = [...rules];
                next[i] = updated;
                setRules(next);
              }}
              onDelete={() => setRules(rules.filter((_, idx) => idx !== i))}
            />
          ))}

          {/* Default catch-all */}
          <div className="flex items-center justify-between px-4 py-3 rounded-xl border border-dashed border-border/60 bg-muted/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Default (ELSE)</span>
              <span className="text-xs text-muted-foreground">— no rules matched</span>
            </div>
            <Badge variant={flag.defaultValue ? "default" : "outline"} className="text-xs">
              {flag.defaultValue ? "True" : "False"}
            </Badge>
          </div>

          <button
            onClick={() => setRules([...rules, { priority: rules.length, value: true, conditions: [] }])}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-3 rounded-xl border border-dashed border-border/50 w-full justify-center hover:bg-muted/30 hover:border-border"
          >
            <Plus className="h-4 w-4" /> Add Rule
          </button>
        </div>
      )}

      {/* Companies tab */}
      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Company Overrides</h3>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {}}>
              <Plus className="w-3.5 h-3.5" />
              Add override
            </Button>
          </div>
          <div className="border border-dashed border-border rounded-xl py-16 flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
              <Building2 className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-foreground">No company overrides</p>
            <p className="text-xs text-muted-foreground max-w-xs text-center">
              Companies with manual flag overrides will appear here, regardless of rule evaluation.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function FeatureFlagsSection() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<FeatureFlag | null>(null);

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/feature-flags");
      if (res.ok) {
        const data = await res.json() as { data: FeatureFlag[] };
        setFlags(data.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  // Flag detail view (inline navigation)
  if (selectedFlag) {
    return (
      <FlagDetailView
        flag={selectedFlag}
        onBack={() => setSelectedFlag(null)}
        onSaved={() => {
          fetchFlags();
          // Keep the flag selected but refresh its data
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            IF plan + usage + trait conditions match → SERVE True.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchFlags} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-1.5 hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Create Flag
          </Button>
        </div>
      </div>

      {/* Flags table */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : flags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-14 text-center space-y-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
            <Flag className="h-6 w-6 text-primary" />
          </div>
          <div>
            <p className="font-medium">No feature flags yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create your first flag to start controlling feature access per company.</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" /> Create Flag
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/60">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Flag</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Rules</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Default</th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {flags.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setSelectedFlag(f)}
                  className="hover:bg-muted/30 cursor-pointer transition-colors group"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-sm">{f.name}</div>
                    <div className="text-xs font-mono text-muted-foreground mt-0.5">{f.featureKey}</div>
                    {f.description && (
                      <div className="text-xs text-muted-foreground/70 mt-0.5 truncate max-w-xs">{f.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3"><TypeBadge flag={f} /></td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-sm">
                      <Settings2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{f.rules.length}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={f.defaultValue ? "default" : "outline"}
                      className={`text-xs ${f.defaultValue ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 dark:text-emerald-400" : ""}`}
                    >
                      {f.defaultValue ? "True" : "False"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create flag sheet */}
      <CreateFlagSheet
        open={showCreate}
        onOpenChange={setShowCreate}
        onCreated={fetchFlags}
      />
    </div>
  );
}
