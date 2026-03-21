"use client";

import { useState, useEffect, useCallback } from "react";
import { Flag, Plus, RefreshCw, ChevronRight, Trash2, GripVertical, Check, X, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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

const CRITERIA_TYPES = [
  { value: "base_plan", label: "Base Plan" },
  { value: "add_on", label: "Add-On" },
  { value: "usage", label: "Usage (Event Count)" },
  { value: "company_trait", label: "Company Trait" },
  { value: "user_trait", label: "User Trait" },
  { value: "zktls_claim", label: "zkTLS Claim (Reclaim)" },
];

const OPERATORS_BY_CRITERIA: Record<string, { value: string; label: string }[]> = {
  base_plan: [{ value: "is_one_of", label: "is one of" }, { value: "is_not_one_of", label: "is not one of" }],
  add_on: [{ value: "is_one_of", label: "is one of" }, { value: "is_not_one_of", label: "is not one of" }],
  usage: [{ value: "is_less_than", label: "< (less than)" }, { value: "is_greater_than", label: "> (greater than)" }],
  company_trait: [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "not equals" },
    { value: "contains", label: "contains" },
    { value: "is_one_of", label: "is one of" },
  ],
  user_trait: [
    { value: "equals", label: "equals" },
    { value: "not_equals", label: "not equals" },
    { value: "contains", label: "contains" },
  ],
  zktls_claim: [{ value: "exists", label: "proof exists" }],
};

function ConditionEditor({
  condition,
  onChange,
  onDelete,
}: {
  condition: Partial<FlagCondition>;
  onChange: (c: Partial<FlagCondition>) => void;
  onDelete: () => void;
}) {
  const criteriaType = condition.criteriaType ?? "base_plan";
  const operators = OPERATORS_BY_CRITERIA[criteriaType] ?? [];

  return (
    <div className="flex items-start gap-2 p-3 bg-muted/30 rounded-md border border-border/50">
      <div className="flex-1 grid grid-cols-2 gap-2 text-sm">
        <select
          value={criteriaType}
          onChange={(e) => onChange({ ...condition, criteriaType: e.target.value, operator: OPERATORS_BY_CRITERIA[e.target.value]?.[0]?.value ?? "equals" })}
          className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
        >
          {CRITERIA_TYPES.map((ct) => (
            <option key={ct.value} value={ct.value}>{ct.label}</option>
          ))}
        </select>

        <select
          value={condition.operator ?? operators[0]?.value ?? "equals"}
          onChange={(e) => onChange({ ...condition, operator: e.target.value })}
          className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
        >
          {operators.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>

        {(criteriaType === "usage") && (
          <>
            <input
              type="text"
              placeholder="Event key (e.g., scan)"
              value={condition.metricKey ?? ""}
              onChange={(e) => onChange({ ...condition, metricKey: e.target.value })}
              className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
            />
            <input
              type="number"
              placeholder="Threshold (e.g., 300)"
              value={condition.metricValue ?? ""}
              onChange={(e) => onChange({ ...condition, metricValue: Number(e.target.value) })}
              className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
            />
            <select
              value={condition.metricPeriod ?? "monthly"}
              onChange={(e) => onChange({ ...condition, metricPeriod: e.target.value })}
              className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
              <option value="daily">Daily</option>
            </select>
          </>
        )}

        {(criteriaType === "company_trait" || criteriaType === "user_trait") && (
          <>
            <input
              type="text"
              placeholder="Trait key (e.g., plan_tier)"
              value={condition.traitKey ?? ""}
              onChange={(e) => onChange({ ...condition, traitKey: e.target.value })}
              className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
            />
            <input
              type="text"
              placeholder="Value (e.g., enterprise)"
              value={(condition.values as string[])?.join(",") ?? ""}
              onChange={(e) => onChange({ ...condition, values: e.target.value.split(",").map((v) => v.trim()) })}
              className="px-2 py-1.5 border border-border rounded-md bg-background text-sm"
            />
          </>
        )}

        {criteriaType === "zktls_claim" && (
          <input
            type="text"
            placeholder="Reclaim Provider ID"
            value={condition.zktlsProviderId ?? ""}
            onChange={(e) => onChange({ ...condition, zktlsProviderId: e.target.value })}
            className="col-span-2 px-2 py-1.5 border border-border rounded-md bg-background text-sm"
          />
        )}

        {(criteriaType === "base_plan" || criteriaType === "add_on") && (
          <input
            type="text"
            placeholder="Plan IDs (comma-separated)"
            value={(condition.values as string[])?.join(",") ?? ""}
            onChange={(e) => onChange({ ...condition, values: e.target.value.split(",").map((v) => v.trim()) })}
            className="col-span-2 px-2 py-1.5 border border-border rounded-md bg-background text-sm"
          />
        )}
      </div>
      <button onClick={onDelete} className="text-muted-foreground hover:text-destructive mt-1">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function RuleEditor({
  rule,
  index,
  onChange,
  onDelete,
}: {
  rule: Partial<FlagRule> & { conditions: Partial<FlagCondition>[] };
  index: number;
  onChange: (r: typeof rule) => void;
  onDelete: () => void;
}) {
  const addCondition = () => {
    onChange({
      ...rule,
      conditions: [
        ...rule.conditions,
        { criteriaType: "base_plan", operator: "is_one_of", values: [] },
      ] as unknown as FlagCondition[],
    });
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-background">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Rule {index + 1}</span>
          <span className="text-xs text-muted-foreground">— IF all conditions match, SERVE:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onChange({ ...rule, value: true })}
              className={`px-2 py-0.5 rounded text-xs font-medium border ${rule.value ? "bg-green-500 text-white border-green-500" : "border-border text-muted-foreground"}`}
            >
              True
            </button>
            <button
              onClick={() => onChange({ ...rule, value: false })}
              className={`px-2 py-0.5 rounded text-xs font-medium border ${!rule.value ? "bg-destructive text-destructive-foreground border-destructive" : "border-border text-muted-foreground"}`}
            >
              False
            </button>
          </div>
        </div>
        <button onClick={onDelete} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2">
        {rule.conditions.map((cond, ci) => (
          <ConditionEditor
            key={ci}
            condition={cond}
            onChange={(updated) => {
              const newConds = [...rule.conditions] as unknown as FlagCondition[];
              newConds[ci] = updated as unknown as FlagCondition;
              onChange({ ...rule, conditions: newConds });
            }}
            onDelete={() => {
              const newConds = rule.conditions.filter((_, i) => i !== ci);
              onChange({ ...rule, conditions: newConds });
            }}
          />
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addCondition}>
        <Plus className="h-3 w-3 mr-1" /> Add Condition
      </Button>
    </div>
  );
}

function FlagDetail({ flag, onBack }: { flag: FeatureFlag; onBack: () => void }) {
  const [rules, setRules] = useState<(Partial<FlagRule> & { conditions: Partial<FlagCondition>[] })[]>(
    flag.rules.map((r) => ({ ...r, conditions: r.conditions })),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const saveRules = async () => {
    setSaving(true);
    try {
      await fetch(`/api/v1/feature-flags/${flag.id}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rules.map((r, i) => ({ ...r, priority: i })) }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const addRule = () => {
    setRules([...rules, { priority: rules.length, value: true, conditions: [] }]);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Flags</Button>
        <Flag className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-semibold">{flag.name}</h2>
        <Badge variant="outline" className="font-mono text-xs">{flag.featureKey}</Badge>
        {flag.featureType === "event_based" && (
          <Badge className="bg-blue-100 text-blue-700 text-xs">
            <Zap className="h-3 w-3 mr-1" /> Event: {flag.eventKey}
          </Badge>
        )}
      </div>

      <div className="rounded-lg border border-border p-4 bg-muted/20">
        <p className="text-sm text-muted-foreground">
          Rules are evaluated top-to-bottom. First matching rule wins. Company overrides always take priority.
        </p>
      </div>

      {/* Rules */}
      <div className="space-y-3">
        {rules.map((rule, i) => (
          <RuleEditor
            key={i}
            rule={rule}
            index={i}
            onChange={(updated) => {
              const newRules = [...rules];
              newRules[i] = updated;
              setRules(newRules);
            }}
            onDelete={() => setRules(rules.filter((_, idx) => idx !== i))}
          />
        ))}

        {/* Default rule */}
        <div className="border border-dashed border-border rounded-lg p-4 text-sm text-muted-foreground">
          <span className="font-medium">Default Rule (ELSE)</span> → SERVE{" "}
          <Badge variant={flag.defaultValue ? "default" : "outline"} className="ml-1 text-xs">
            {flag.defaultValue ? "True" : "False"}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={addRule} variant="outline">
          <Plus className="h-4 w-4 mr-1" /> Add Rule
        </Button>
        <Button size="sm" onClick={saveRules} disabled={saving}>
          {saving ? "Saving..." : saved ? <><Check className="h-4 w-4 mr-1" /> Saved</> : "Save Rules"}
        </Button>
      </div>
    </div>
  );
}

export function FeatureFlagsSection() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFlag, setSelectedFlag] = useState<FeatureFlag | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ featureKey: "", name: "", featureType: "boolean", eventKey: "" });
  const [creating, setCreating] = useState(false);

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

  const handleCreate = async () => {
    if (!createForm.featureKey || !createForm.name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateForm({ featureKey: "", name: "", featureType: "boolean", eventKey: "" });
        fetchFlags();
      }
    } finally {
      setCreating(false);
    }
  };

  if (selectedFlag) {
    return (
      <FlagDetail
        flag={selectedFlag}
        onBack={() => { setSelectedFlag(null); fetchFlags(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Feature Flags</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Define features and targeting rules — IF plan + usage → SERVE True.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchFlags} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Flag
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : flags.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Flag className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No feature flags yet. Create your first flag.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Flag</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Rules</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Default</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                  onClick={() => setSelectedFlag(f)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{f.name}</div>
                    <div className="text-xs font-mono text-muted-foreground">{f.featureKey}</div>
                  </td>
                  <td className="px-4 py-3">
                    {f.featureType === "event_based" ? (
                      <Badge className="bg-blue-100 text-blue-700 text-xs">
                        <Zap className="h-3 w-3 mr-1" /> Event
                      </Badge>
                    ) : f.featureType === "zktls" ? (
                      <Badge className="bg-purple-100 text-purple-700 text-xs">
                        <Shield className="h-3 w-3 mr-1" /> zkTLS
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">Boolean</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{f.rules.length}</td>
                  <td className="px-4 py-3">
                    <Badge variant={f.defaultValue ? "default" : "outline"} className="text-xs">
                      {f.defaultValue ? "True" : "False"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3"><ChevronRight className="h-4 w-4 text-muted-foreground" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg border border-border p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-semibold mb-4">Create Feature Flag</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name *</label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value, featureKey: e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "_") })}
                  placeholder="AI Summary"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Feature Key *</label>
                <input
                  type="text"
                  value={createForm.featureKey}
                  onChange={(e) => setCreateForm({ ...createForm, featureKey: e.target.value })}
                  placeholder="ai_summary"
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Feature Type</label>
                <select
                  value={createForm.featureType}
                  onChange={(e) => setCreateForm({ ...createForm, featureType: e.target.value })}
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="boolean">Boolean (on/off)</option>
                  <option value="event_based">Event-based (usage tracked)</option>
                </select>
              </div>
              {createForm.featureType === "event_based" && (
                <div>
                  <label className="text-sm font-medium">Event Key</label>
                  <input
                    type="text"
                    value={createForm.eventKey}
                    onChange={(e) => setCreateForm({ ...createForm, eventKey: e.target.value })}
                    placeholder="scan"
                    className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono"
                  />
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-6 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button size="sm" onClick={handleCreate} disabled={creating || !createForm.featureKey || !createForm.name}>
                {creating ? "Creating..." : "Create Flag"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
