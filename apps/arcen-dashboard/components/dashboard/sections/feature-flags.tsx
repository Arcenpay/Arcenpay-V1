"use client";
import { apiFetch } from "@/lib/api-client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Flag, Plus, RefreshCw, Trash2, GripVertical, Check, X,
  Zap, Shield, ChevronRight, Settings2, Info, ArrowLeft,
  MoreHorizontal, Copy, Building2, Pencil,
} from "lucide-react";
import { SkeletonList, SkeletonTable } from "@/components/ui/skeleton";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

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
  source?: string | null;
  sourceId?: string | null;
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
  linkedPlans: CatalogPlanOption[];
  planEntitlements: PlanEntitlementSummary[];
  planRules: FlagRule[];
  rules: FlagRule[];
}

interface CompanyOverrideRow {
  id: string;
  companyId: string;
  featureKey: string;
  value: boolean;
  reason: string | null;
  updatedAt?: string;
  company?: {
    id: string;
    name: string | null;
    email: string | null;
    walletAddress: string | null;
  } | null;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface CatalogPlanOption {
  id: string;
  name: string;
  tier: string;
}

interface PlanEntitlementSummary extends CatalogPlanOption {
  type: "BOOLEAN" | "NUMERIC" | "UNLIMITED";
  value: boolean | number | null;
  valueUnit?: string | null;
}

interface CatalogAddOnOption {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MANUAL_CRITERIA_TYPES = [
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

function isPlanManagedRule(rule: Pick<FlagRule, "source" | "conditions">) {
  return (
    rule.source === "plan" ||
    rule.conditions.some((condition) => condition.criteriaType === "base_plan")
  );
}

const CRITERIA_LABELS: Record<string, string> = {
  base_plan: "Base Plan",
  add_on: "Add-On",
  usage: "Usage",
  company_trait: "Company Trait",
  user_trait: "User Trait",
  zktls_claim: "zkTLS Claim",
};

function formatConditionValueSummary(condition: Pick<
  FlagCondition,
  "criteriaType" | "operator" | "values" | "metricKey" | "metricValue" | "metricPeriod" | "traitKey" | "zktlsProviderId"
>) {
  const metricPeriodLabel =
    condition.metricPeriod === "plan_period"
      ? "billing cycle"
      : condition.metricPeriod;
  switch (condition.criteriaType) {
    case "base_plan":
    case "add_on":
      return (Array.isArray(condition.values) ? condition.values : [])
        .filter((value) => typeof value === "string" && value.length > 0)
        .join(", ");
    case "usage":
      return [condition.metricKey, condition.operator === "is_less_than" ? "<" : condition.operator, condition.metricValue, metricPeriodLabel]
        .filter((value) => value !== null && value !== undefined && value !== "")
        .join(" · ");
    case "company_trait":
    case "user_trait":
      return [condition.traitKey, ...(Array.isArray(condition.values) ? condition.values : [])]
        .filter((value) => typeof value === "string" && value.length > 0)
        .join(" · ");
    case "zktls_claim":
      return condition.zktlsProviderId ?? "Proof exists";
    default:
      return "";
  }
}

// ─── ConditionEditor ──────────────────────────────────────────────────────────

function ConditionEditor({ condition, onChange, onDelete }: {
  condition: Partial<FlagCondition>;
  onChange: (c: Partial<FlagCondition>) => void;
  onDelete: () => void;
}) {
  const type = condition.criteriaType ?? "company_trait";
  const ops  = OPERATORS_BY_CRITERIA[type] ?? [];

  const [addOns, setAddOns] = useState<CatalogAddOnOption[]>([]);

  useEffect(() => {
    if (type === "add_on") {
      apiFetch("/api/catalog/add-ons")
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
          {MANUAL_CRITERIA_TYPES.map((ct) => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
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
              <option value="plan_period">Billing cycle</option>
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
      conditions: [...rule.conditions, { criteriaType: "company_trait", operator: "equals", values: [] }] as unknown as FlagCondition[],
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
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${rule.value ? "bg-secondary text-foreground border-border dark:text-foreground" : "border-border text-muted-foreground hover:border-emerald-400/50"}`}>
              True
            </button>
            <button onClick={() => onChange({ ...rule, value: false })}
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${!rule.value ? "bg-secondary text-destructive border-border" : "border-border text-muted-foreground hover:border-border"}`}>
              False
            </button>
          </div>
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded hover:bg-secondary">
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

function formatPlanEntitlementValue(
  planEntitlement: PlanEntitlementSummary,
  fallbackUnitLabel: string,
) {
  if (planEntitlement.type === "BOOLEAN") {
    return "Enabled";
  }

  if (planEntitlement.type === "UNLIMITED") {
    return "Unlimited";
  }

  return `${planEntitlement.value ?? "—"} ${
    planEntitlement.valueUnit || fallbackUnitLabel
  } per month`;
}

function EditPlanEntitlementSheet({
  flag,
  planEntitlement,
  open,
  onOpenChange,
  onSaved,
}: {
  flag: FeatureFlag;
  planEntitlement: PlanEntitlementSummary | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    type: "BOOLEAN" as "BOOLEAN" | "NUMERIC" | "UNLIMITED",
    value: "",
    valueUnit: "",
    enabled: true,
  });

  useEffect(() => {
    if (!open || !planEntitlement) return;

    setForm({
      type: planEntitlement.type,
      value:
        planEntitlement.type === "NUMERIC" && typeof planEntitlement.value === "number"
          ? String(planEntitlement.value)
          : "",
      valueUnit: planEntitlement.valueUnit ?? flag.eventKey ?? flag.featureKey,
      enabled: true,
    });
    setErrors({});
  }, [flag.eventKey, flag.featureKey, open, planEntitlement]);

  async function handleSave() {
    if (!planEntitlement) return;

    const nextErrors: Record<string, string> = {};
    if (form.type === "NUMERIC") {
      const nextValue = Number(form.value);
      if (form.value === "" || Number.isNaN(nextValue) || nextValue < 0) {
        nextErrors.value = "Enter a valid monthly limit";
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setLoading(true);
    try {
      const value =
        form.type === "BOOLEAN"
          ? form.enabled
          : form.type === "NUMERIC"
            ? Number(form.value)
            : null;

      const res = await apiFetch(`/api/catalog/plans/${planEntitlement.id}/entitlements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey: flag.featureKey,
          featureName: flag.name,
          type: form.type,
          value,
          valueUnit: form.type === "NUMERIC" ? form.valueUnit || null : null,
          enabled: form.enabled,
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrors({ _global: data.error || "Failed to update entitlement" });
        return;
      }

      onOpenChange(false);
      onSaved();
      toast.success(`Updated ${planEntitlement.name}`);
    } finally {
      setLoading(false);
    }
  }

  const planSupportsUsage = flag.featureType !== "boolean";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="sm:max-w-lg flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border/60">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Plan Entitlement
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <SheetTitle className="text-lg font-semibold">{planEntitlement?.name ?? "Plan"}</SheetTitle>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
            <span className="text-lg text-muted-foreground font-normal">{flag.name}</span>
          </div>
          <SheetDescription>
            This saves back to Plan Catalog and refreshes the live rule shown in Flags.
          </SheetDescription>
        </SheetHeader>

        {planEntitlement && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{planEntitlement.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {planEntitlement.tier} plan · {flag.featureKey}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    Synced
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add or remove plan access from Plan Catalog. Use this view to update the linked entitlement settings in one place.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Entitlement type</Label>
                <div className="grid grid-cols-1 gap-2">
                  {(["BOOLEAN", "NUMERIC", "UNLIMITED"] as const)
                    .filter((type) => {
                      if (!planSupportsUsage) return type === "BOOLEAN";
                      return type === "NUMERIC" || type === "UNLIMITED";
                    })
                    .map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            type,
                            value: type === "NUMERIC" ? current.value : "",
                          }))
                        }
                        className={`flex items-center gap-3 px-3 py-3 rounded-lg border text-sm transition-all text-left ${
                          form.type === type
                            ? "bg-accent/5 border-accent text-foreground"
                            : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            form.type === type ? "bg-accent/10" : "bg-card border border-border"
                          }`}
                        >
                          {type === "BOOLEAN" ? (
                            <Flag className={`w-4 h-4 ${form.type === type ? "text-accent" : "text-muted-foreground"}`} />
                          ) : type === "NUMERIC" ? (
                            <Zap className={`w-4 h-4 ${form.type === type ? "text-accent" : "text-muted-foreground"}`} />
                          ) : (
                            <Shield className={`w-4 h-4 ${form.type === type ? "text-accent" : "text-muted-foreground"}`} />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium leading-none">
                            {type === "BOOLEAN" ? "Boolean access" : type === "NUMERIC" ? "Usage limit" : "Unlimited"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {type === "BOOLEAN"
                              ? "Simple on or off access"
                              : type === "NUMERIC"
                                ? "Monthly allowance enforced during evaluation"
                                : "No cap for this plan"}
                          </p>
                        </div>
                        {form.type === type && <Check className="w-4 h-4 text-accent shrink-0" />}
                      </button>
                    ))}
                </div>
              </div>

              {form.type === "NUMERIC" && (
                <div className="space-y-3 p-4 rounded-lg bg-secondary/30 border border-border">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Monthly limit</Label>
                    <Input
                      type="number"
                      min="0"
                      value={form.value}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, value: event.target.value }))
                      }
                      placeholder="e.g. 300"
                      className="bg-background border-border"
                    />
                    {errors.value && <p className="text-xs text-destructive">{errors.value}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Unit label</Label>
                    <Input
                      value={form.valueUnit}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, valueUnit: event.target.value }))
                      }
                      placeholder={flag.eventKey ?? flag.featureKey}
                      className="bg-background border-border"
                    />
                    <p className="text-xs text-muted-foreground">
                      This renders and evaluates as {form.value || "0"} {form.valueUnit || flag.eventKey || flag.featureKey} per month.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 border border-border">
                <div>
                  <p className="text-sm font-medium">Enabled</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Turn this entitlement on or off for the selected plan
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(enabled) => setForm((current) => ({ ...current, enabled }))}
                />
              </div>

              {errors._global && (
                <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-destructive">
                  {errors._global}
                </div>
              )}
            </div>

            <SheetFooter className="px-6 py-4 border-t border-border/60 flex-row gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={loading} className="flex-1">
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save entitlement"
                )}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReadOnlyRuleCard({
  rule,
  index,
  planEntitlement,
  fallbackUnitLabel,
  highlighted,
  onEdit,
}: {
  rule: FlagRule;
  index: number;
  planEntitlement?: PlanEntitlementSummary;
  fallbackUnitLabel: string;
  highlighted?: boolean;
  onEdit: () => void;
}) {
  return (
    <div
      className={`border rounded-xl bg-card shadow-sm overflow-hidden transition-all ${
        highlighted ? "border-accent ring-2 ring-accent/15" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/60 gap-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Rule {index + 1}
          </span>
          <Badge variant="outline" className="text-[11px]">
            Synced from Plan Catalog
          </Badge>
          <span className="text-xs text-muted-foreground">
            This plan-linked rule stays in sync with the catalog entitlement.
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="text-xs bg-secondary text-foreground border-border dark:text-foreground">
            Active
          </Badge>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" />
            Edit
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Linked Plan
            </p>
            {planEntitlement ? (
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {planEntitlement.name}
                  <span className="ml-1 opacity-60">· {planEntitlement.tier}</span>
                </Badge>
              </div>
            ) : (
              <Badge variant="secondary" className="text-xs mt-1">
                Unknown plan
              </Badge>
            )}
          </div>
          {planEntitlement && (
            <div className="text-left sm:text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Entitlement Value
              </p>
              <p className="text-sm font-medium text-foreground mt-1">
                {formatPlanEntitlementValue(planEntitlement, fallbackUnitLabel)}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          {rule.conditions.map((condition, conditionIndex) => (
            <div
              key={`${rule.id}-condition-${conditionIndex}`}
              className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
            >
              <p className="text-xs font-medium text-foreground">
                {CRITERIA_LABELS[condition.criteriaType] ?? condition.criteriaType}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {OPERATORS_BY_CRITERIA[condition.criteriaType]?.find(
                  (operator) => operator.value === condition.operator,
                )?.label ?? condition.operator}
                {formatConditionValueSummary(condition) ? ` · ${formatConditionValueSummary(condition)}` : ""}
              </p>
            </div>
          ))}
        </div>
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
      const res = await apiFetch(`/api/v1/feature-flags/${flag.id}/rules`, {
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
              <Badge className="bg-secondary text-foreground border-border text-xs dark:text-foreground">
                <Zap className="h-3 w-3 mr-1" /> {flag.eventKey}
              </Badge>
            )}
            {flag.featureType === "zktls" && (
              <Badge className="bg-secondary text-foreground border-border text-xs dark:text-foreground">
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
      const res = await apiFetch("/api/v1/feature-flags", {
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
            <div className="flex items-start gap-2 p-3 rounded-lg bg-secondary border border-border text-destructive text-sm">
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
      <Badge className="bg-secondary text-foreground border border-border text-xs dark:text-foreground gap-1">
        <Zap className="h-3 w-3" /> Event
      </Badge>
    );
  }
  if (flag.featureType === "zktls") {
    return (
      <Badge className="bg-secondary text-foreground border border-border text-xs dark:text-foreground gap-1">
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
  focusedPlanId,
  onPlanEditorHandled,
}: {
  flag: FeatureFlag;
  onBack: () => void;
  onSaved: () => void;
  focusedPlanId?: string | null;
  onPlanEditorHandled?: () => void;
}) {
  const [detailTab, setDetailTab] = useState<"rules" | "companies">("rules");
  const [rules, setRules] = useState<(Partial<FlagRule> & { conditions: Partial<FlagCondition>[] })[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<CompanyOverrideRow[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideCompanyId, setOverrideCompanyId] = useState("");
  const [overrideValue, setOverrideValue] = useState(true);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideBusy, setOverrideBusy] = useState(false);

  // Initialize rules from flag
  useState(() => {
    setRules(flag.rules.map((r) => ({ ...r })));
  });

  // Re-sync when flag changes
  useEffect(() => {
    setRules(flag.rules.map((r) => ({ ...r })));
  }, [flag]);

  useEffect(() => {
    if (!focusedPlanId) return;
    if (!flag.planEntitlements.some((planEntitlement) => planEntitlement.id === focusedPlanId)) {
      return;
    }

    setEditingPlanId(focusedPlanId);
    onPlanEditorHandled?.();
  }, [flag.planEntitlements, focusedPlanId, onPlanEditorHandled]);

  useEffect(() => {
    if (detailTab !== "companies") return;
    let cancelled = false;

    async function loadOverrides() {
      setOverridesLoading(true);
      try {
        const [overridesRes, companiesRes] = await Promise.all([
          apiFetch(`/api/v1/feature-flags/${flag.id}/overrides`, { cache: "no-store" }),
          apiFetch("/api/v1/companies?limit=100", { cache: "no-store" }),
        ]);

        const overridesData = overridesRes.ok
          ? ((await overridesRes.json()) as { data?: CompanyOverrideRow[] })
          : { data: [] };
        const companiesData = companiesRes.ok
          ? ((await companiesRes.json()) as {
              data?: Array<{ id: string; name: string | null }>;
            })
          : { data: [] };

        if (cancelled) return;
        setOverrides(Array.isArray(overridesData.data) ? overridesData.data : []);
        setCompanies(
          Array.isArray(companiesData.data)
            ? companiesData.data.map((company) => ({
                id: company.id,
                name: company.name?.trim() || company.id,
              }))
            : [],
        );
      } finally {
        if (!cancelled) setOverridesLoading(false);
      }
    }

    void loadOverrides();
    return () => {
      cancelled = true;
    };
  }, [detailTab, flag.id]);

  const saveRules = async () => {
    const editableRules = rules.filter(
      (rule): rule is Partial<FlagRule> & { conditions: Partial<FlagCondition>[] } =>
        !isPlanManagedRule({
          source: rule.source ?? null,
          conditions: (rule.conditions ?? []) as FlagCondition[],
        }),
    );

    setSaving(true);
    try {
      const res = await apiFetch(`/api/v1/feature-flags/${flag.id}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rules: editableRules.map((rule, index) => ({
            ...rule,
            priority: rule.priority ?? index,
          })),
        }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => { setSaved(false); onSaved(); }, 1500);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Failed to save rules");
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

  async function createOverride() {
    if (!overrideCompanyId) return;
    setOverrideBusy(true);
    try {
      const res = await apiFetch(`/api/v1/feature-flags/${flag.id}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: overrideCompanyId,
          value: overrideValue,
          reason: overrideReason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to save override");
      }
      setOverrides((prev) => {
        const next = prev.filter((row) => row.companyId !== data.data.companyId);
        return [data.data as CompanyOverrideRow, ...next];
      });
      setShowOverrideForm(false);
      setOverrideCompanyId("");
      setOverrideReason("");
      setOverrideValue(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save override");
    } finally {
      setOverrideBusy(false);
    }
  }

  async function removeOverride(companyId: string) {
    setOverrideBusy(true);
    try {
      const res = await apiFetch(
        `/api/v1/feature-flags/${flag.id}/overrides?companyId=${encodeURIComponent(companyId)}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? "Failed to delete override");
      }
      setOverrides((prev) => prev.filter((row) => row.companyId !== companyId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete override");
    } finally {
      setOverrideBusy(false);
    }
  }

  const DETAIL_TABS = ["rules", "companies"] as const;
  const planEntitlementsById = new Map(
    (flag.planEntitlements ?? []).map((planEntitlement) => [planEntitlement.id, planEntitlement]),
  );
  const planRules = flag.planRules ?? [];
  const editableRules = rules.filter((rule) =>
    !isPlanManagedRule({
      source: rule.source ?? null,
      conditions: (rule.conditions ?? []) as FlagCondition[],
    }),
  );
  const totalRuleCount = planRules.length + editableRules.length;
  const fallbackUnitLabel = flag.eventKey ?? flag.featureKey;

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
                  {copiedKey ? <Check className="w-3 h-3 text-foreground" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>

          {/* Right: type badge + actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <TypeBadge flag={flag} />
            <Badge
              variant={flag.defaultValue ? "default" : "outline"}
              className={`text-xs ${flag.defaultValue ? "bg-secondary text-foreground border-border dark:text-foreground" : ""}`}
            >
              Default: {flag.defaultValue ? "True" : "False"}
            </Badge>
            <div className="h-6 w-px bg-border hidden sm:block" />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={saveRules} disabled={saving} className="gap-1.5">
                {saving ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" />Saving…</>
                ) : saved ? (
                  <><Check className="w-3.5 h-3.5 text-foreground" />Saved</>
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
                      <><Check className="w-3.5 h-3.5 mr-2 text-foreground" />Copied!</>
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
              {tab === "rules" && totalRuleCount > 0 && (
                <span className="ml-2 text-xs bg-secondary rounded-full px-1.5 py-0.5">
                  {totalRuleCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Rules tab */}
      {detailTab === "rules" && (
        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              Plan-linked access stays synced here
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Add or remove plan access from Plan Catalog. Edit the linked entitlement here when you need to adjust the live rule for a specific plan.
            </p>
          </div>

          {planRules.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Plan entitlement rules</h3>
                <Badge variant="outline" className="text-xs">
                  {planRules.length}
                </Badge>
              </div>
              {planRules.map((rule, index) => (
                <ReadOnlyRuleCard
                  key={rule.id}
                  rule={rule}
                  index={index}
                  planEntitlement={rule.sourceId ? planEntitlementsById.get(rule.sourceId) : undefined}
                  fallbackUnitLabel={fallbackUnitLabel}
                  highlighted={rule.sourceId === focusedPlanId}
                  onEdit={() => setEditingPlanId(rule.sourceId ?? null)}
                />
              ))}
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Additional flag rules</h3>
              <Badge variant="outline" className="text-xs">
                {editableRules.length}
              </Badge>
            </div>

            {editableRules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">No additional flag rules yet</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Add manual rules here for traits, usage, add-ons, or overrides on top of your catalog setup.
                </p>
              </div>
            ) : (
              editableRules.map((rule, index) => {
                const ruleIndex = rules.indexOf(rule);
                return (
                  <RuleEditor
                    key={rule.id ?? `editable-${index}`}
                    rule={rule}
                    index={planRules.length + index}
                    onChange={(updated) => {
                      setRules((current) => {
                        const next = [...current];
                        next[ruleIndex] = updated;
                        return next;
                      });
                    }}
                    onDelete={() =>
                      setRules((current) => current.filter((_, idx) => idx !== ruleIndex))
                    }
                  />
                );
              })
            )}
          </div>

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
            onClick={() =>
              setRules([
                ...rules,
                { priority: editableRules.length, value: true, source: "manual", conditions: [] },
              ])
            }
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-3 rounded-xl border border-dashed border-border/50 w-full justify-center hover:bg-muted/30 hover:border-border"
          >
            <Plus className="h-4 w-4" /> Add Rule
          </button>

          <EditPlanEntitlementSheet
            flag={flag}
            planEntitlement={editingPlanId ? planEntitlementsById.get(editingPlanId) ?? null : null}
            open={editingPlanId !== null}
            onOpenChange={(open) => {
              if (!open) setEditingPlanId(null);
            }}
            onSaved={onSaved}
          />
        </div>
      )}

      {/* Companies tab */}
      {detailTab === "companies" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Company Overrides</h3>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setShowOverrideForm((value) => !value)}
            >
              <Plus className="w-3.5 h-3.5" />
              {showOverrideForm ? "Close" : "Add override"}
            </Button>
          </div>
          {showOverrideForm && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Company</Label>
                  <Select value={overrideCompanyId} onValueChange={setOverrideCompanyId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a company" />
                    </SelectTrigger>
                    <SelectContent>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Override value</Label>
                  <Select
                    value={overrideValue ? "true" : "false"}
                    onValueChange={(value) => setOverrideValue(value === "true")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Force True</SelectItem>
                      <SelectItem value="false">Force False</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Reason</Label>
                  <Input
                    value={overrideReason}
                    onChange={(event) => setOverrideReason(event.target.value)}
                    placeholder="Optional note"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void createOverride()}
                  disabled={!overrideCompanyId || overrideBusy}
                >
                  Save Override
                </Button>
              </div>
            </div>
          )}
          {overridesLoading ? (
            <SkeletonTable rows={2} cols={4} />
          ) : overrides.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl py-16 flex flex-col items-center justify-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-2">
                <Building2 className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-sm font-medium text-foreground">No company overrides</p>
              <p className="text-xs text-muted-foreground max-w-xs text-center">
                Companies with manual flag overrides will appear here, regardless of rule evaluation.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 border-b border-border/60">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Company</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Value</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Reason</th>
                    <th className="px-4 py-2.5 w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {overrides.map((override) => (
                    <tr key={override.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-sm">
                          {override.company?.name || override.company?.email || override.company?.walletAddress || override.companyId}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={override.value ? "default" : "outline"}>
                          {override.value ? "True" : "False"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {override.reason || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          disabled={overrideBusy}
                          onClick={() => void removeOverride(override.companyId)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function FeatureFlagsSection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedFlag, setSelectedFlag] = useState<FeatureFlag | null>(null);
  const requestedFlagKey = searchParams.get("flag")?.trim().toLowerCase() ?? "";
  const requestedPlanId = searchParams.get("planId");
  const shouldAutoEditPlan = searchParams.get("editPlan") === "1";

  const navigateFlagView = useCallback(
    (
      {
        flagKey,
        planId,
        editPlan,
      }: { flagKey?: string | null; planId?: string | null; editPlan?: boolean },
      replace = false,
    ) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("section", "feature-flags");

      if (flagKey) params.set("flag", flagKey);
      else params.delete("flag");

      if (planId) params.set("planId", planId);
      else params.delete("planId");

      if (editPlan) params.set("editPlan", "1");
      else params.delete("editPlan");

      const nextUrl = `/?${params.toString()}`;
      if (replace) {
        router.replace(nextUrl, { scroll: false });
      } else {
        router.push(nextUrl, { scroll: false });
      }
    },
    [router, searchParams],
  );

  const fetchFlags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/feature-flags");
      if (res.ok) {
        const data = await res.json() as { data: FeatureFlag[] };
        const nextFlags = data.data ?? [];
        setFlags(nextFlags);
        setSelectedFlag((current) =>
          current ? nextFlags.find((flag) => flag.id === current.id) ?? null : current,
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFlags(); }, [fetchFlags]);

  useEffect(() => {
    if (!requestedFlagKey) {
      setSelectedFlag((current) => (current ? null : current));
      return;
    }

    const matchedFlag = flags.find(
      (flag) => flag.featureKey.toLowerCase() === requestedFlagKey,
    );

    if (matchedFlag && matchedFlag.id !== selectedFlag?.id) {
      setSelectedFlag(matchedFlag);
    }
  }, [flags, requestedFlagKey, selectedFlag?.id]);

  // Flag detail view (inline navigation)
  if (selectedFlag) {
    return (
      <FlagDetailView
        flag={selectedFlag}
        focusedPlanId={shouldAutoEditPlan ? requestedPlanId : null}
        onPlanEditorHandled={() =>
          navigateFlagView({ flagKey: selectedFlag.featureKey }, true)
        }
        onBack={() => {
          setSelectedFlag(null);
          navigateFlagView({}, true);
        }}
        onSaved={() => {
          void fetchFlags();
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
            Use flags for traits, usage, add-ons, and overrides. Plan entitlements sync here from Plan Catalog.
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
        <SkeletonTable rows={3} cols={5} />
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
              {flags.map((f) => {
                const totalRules = (f.planRules?.length ?? 0) + f.rules.length;
                return (
                <tr
                  key={f.id}
                  onClick={() => {
                    setSelectedFlag(f);
                    navigateFlagView({ flagKey: f.featureKey });
                  }}
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
                      <span className="text-muted-foreground">{totalRules}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={f.defaultValue ? "default" : "outline"}
                      className={`text-xs ${f.defaultValue ? "bg-secondary text-foreground border-border dark:text-foreground" : ""}`}
                    >
                      {f.defaultValue ? "True" : "False"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                  </td>
                </tr>
                );
              })}
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
