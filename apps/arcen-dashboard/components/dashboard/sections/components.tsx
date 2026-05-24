"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Plus,
  Trash2,
  Layers,
  Copy,
  X,
  Check,
  ArrowUpDown,
  ShieldCheck,
  Gauge,
  Clock,
  ReceiptText,
  FileText,
  AlertTriangle,
} from "lucide-react";
import {
  ComponentEditor,
  type ComponentConfig,
  type ComponentElement,
} from "@/components/dashboard/component-editor";
import { normalizeComponentStyling } from "@/lib/component-design";
import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";

// ─── Customer Portal preset elements ─────────────────────────
const PORTAL_ELEMENTS: ComponentElement[] = [
  {
    id: "pm-1",
    type: "plan-manager",
    label: "Plan Manager",
    icon: ArrowUpDown,
    props: {},
  },
  {
    id: "mf-1",
    type: "metered-features",
    label: "Metered Features",
    icon: Gauge,
    props: {},
  },
  {
    id: "if-1",
    type: "included-features",
    label: "Included Features",
    icon: ShieldCheck,
    props: {},
  },
  {
    id: "nb-1",
    type: "next-bill-due",
    label: "Next Bill Due",
    icon: Clock,
    props: {},
  },
  {
    id: "inv-1",
    type: "invoices",
    label: "Invoices",
    icon: ReceiptText,
    props: {},
  },
  {
    id: "bh-1",
    type: "billing-history",
    label: "Billing History",
    icon: FileText,
    props: {},
  },
];

// ─── Mini Portal preview thumbnail ───────────────────────────
function PortalThumbnail() {
  return (
    <div className="w-full h-full bg-white rounded-lg overflow-hidden p-2 flex flex-col gap-1.5 select-none">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-0.5">
        <div className="h-2 w-16 rounded bg-gray-900/80" />
        <div className="h-3.5 w-12 rounded bg-gray-900 flex items-center justify-center">
          <span className="text-[5px] font-bold text-white">Change Plan</span>
        </div>
      </div>
      {/* Two-column layout */}
      <div className="flex gap-1.5 flex-1">
        {/* Left col */}
        <div className="flex-[1.4] flex flex-col gap-1.5">
          {/* Plan card */}
          <div className="rounded border border-gray-100 p-1.5 bg-gray-50">
            <div className="h-3 w-8 rounded bg-gray-900/70 mb-0.5" />
            <div className="h-1.5 w-14 rounded bg-gray-300 mb-1" />
            <div className="h-2.5 w-full rounded bg-gray-900/80 flex items-center justify-center">
              <span className="text-[4px] text-white font-semibold">
                Change Plan
              </span>
            </div>
          </div>
          {/* Usage */}
          <div className="rounded border border-gray-100 p-1.5 bg-gray-50">
            <div className="h-1.5 w-10 rounded bg-gray-400 mb-1" />
            <div className="flex items-center justify-between mb-0.5">
              <div className="h-1 w-6 rounded bg-gray-300" />
              <div className="h-1 w-4 rounded bg-gray-200" />
            </div>
            <div className="h-1 w-full rounded-full bg-gray-200">
              <div className="h-1 w-1/3 rounded-full bg-gray-700" />
            </div>
          </div>
          {/* Included features */}
          <div className="rounded border border-gray-100 p-1.5 bg-gray-50 flex-1">
            <div className="h-1.5 w-14 rounded bg-gray-400 mb-1" />
            {[0.7, 0.5, 0.6].map((w, i) => (
              <div key={i} className="flex items-center gap-1 mb-0.5">
                <div className="w-1 h-1 rounded-full bg-gray-600 shrink-0" />
                <div
                  className="h-1 rounded bg-gray-200"
                  style={{ width: `${w * 100}%` }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Right col */}
        <div className="flex-1 flex flex-col gap-1.5">
          {/* Billing info */}
          <div className="rounded border border-gray-100 p-1.5 bg-gray-50">
            <div className="h-1.5 w-12 rounded bg-gray-400 mb-0.5" />
            <div className="h-2.5 w-14 rounded bg-gray-300 mb-1" />
            <div className="h-1 w-full rounded bg-gray-200" />
          </div>
          {/* Invoice rows */}
          <div className="rounded border border-gray-100 p-1.5 bg-gray-50 flex-1">
            <div className="h-1.5 w-10 rounded bg-gray-400 mb-1" />
            {[0.8, 0.9, 0.7].map((w, i) => (
              <div key={i} className="flex gap-1 mb-0.5">
                <div className="h-1 flex-1 rounded bg-gray-100" />
                <div className="h-1 w-3 rounded bg-gray-200" />
              </div>
            ))}
          </div>
          {/* Unsubscribe btn */}
          <div className="h-4 w-full rounded bg-gray-900 flex items-center justify-center">
            <span className="text-[4px] text-white font-bold">Unsubscribe</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Blank thumbnail ──────────────────────────────────────────
function BlankThumbnail() {
  return (
    <div className="w-full h-full bg-white rounded-lg flex items-center justify-center select-none">
      <div className="flex flex-col items-center gap-2 opacity-25">
        <div className="w-8 h-8 rounded-full border-2 border-dashed border-gray-400 flex items-center justify-center">
          <Plus className="w-4 h-4 text-gray-400" />
        </div>
        <div className="space-y-1">
          <div className="h-1.5 w-16 rounded bg-gray-300" />
          <div className="h-1.5 w-12 rounded bg-gray-200 mx-auto" />
        </div>
      </div>
    </div>
  );
}

// ─── CreateComponentModal ─────────────────────────────────────
function CreateComponentModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, template: "customer-portal" | "blank") => void;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<"customer-portal" | "blank" | null>(
    null,
  );
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const canCreate = name.trim().length > 0 && selected !== null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && canCreate) onCreate(name.trim(), selected!);
  };

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative bg-background border border-border rounded-2xl w-full max-w-[500px] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-foreground tracking-tight">
                New component
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Pick a template and name your component.
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-secondary hover:text-foreground transition-all -mt-0.5 -mr-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Name */}
          <div className="mb-5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              Name
            </label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Billing Portal"
              className="w-full h-10 px-3.5 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-foreground/20 focus:border-foreground/30 transition-all"
            />
          </div>

          {/* Templates — 2-column grid */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2.5">
              Template
            </label>
            <div className="grid grid-cols-2 gap-3">
              {/* Customer Portal */}
              <button
                onClick={() => setSelected("customer-portal")}
                className={cn(
                  "relative flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all duration-150",
                  selected === "customer-portal"
                    ? "border-foreground"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <div className="h-28 w-full bg-gray-50">
                  <PortalThumbnail />
                </div>
                <div className="p-3 bg-background border-t border-border">
                  <p className="text-sm font-semibold text-foreground leading-tight">
                    Customer Portal
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Plans, usage & billing hub
                  </p>
                </div>
                {selected === "customer-portal" && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-foreground flex items-center justify-center shadow-sm">
                    <Check className="w-3 h-3 text-background" />
                  </div>
                )}
              </button>

              {/* Blank */}
              <button
                onClick={() => setSelected("blank")}
                className={cn(
                  "relative flex flex-col rounded-xl border-2 overflow-hidden text-left transition-all duration-150",
                  selected === "blank"
                    ? "border-foreground"
                    : "border-border hover:border-foreground/30",
                )}
              >
                <div className="h-28 w-full bg-gray-50">
                  <BlankThumbnail />
                </div>
                <div className="p-3 bg-background border-t border-border">
                  <p className="text-sm font-semibold text-foreground leading-tight">
                    Blank
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Start from scratch
                  </p>
                </div>
                {selected === "blank" && (
                  <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-foreground flex items-center justify-center shadow-sm">
                    <Check className="w-3 h-3 text-background" />
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="h-9 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            Cancel
          </button>
          <button
            disabled={!canCreate}
            onClick={() => canCreate && onCreate(name.trim(), selected!)}
            className={cn(
              "h-9 px-5 rounded-lg text-sm font-semibold transition-all",
              canCreate
                ? "bg-foreground text-background hover:opacity-80"
                : "bg-secondary text-muted-foreground cursor-not-allowed",
            )}
          >
            Create component
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============================================================
// Main Components Section
// ============================================================

interface ComponentsSectionProps {
  onSectionChange?: (section: Section) => void;
}

export function ComponentsSection({ onSectionChange }: ComponentsSectionProps = {}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [customComponents, setCustomComponents] = useState<ComponentConfig[]>(
    [],
  );
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentConfig | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // ── Prerequisite check ────────────────────────────────────
  const [prereqs, setPrereqs] = useState<{
    publishedPlans: number;
    onChainPlans: number;
    featureFlags: number;
    loading: boolean;
  }>({ publishedPlans: 0, onChainPlans: 0, featureFlags: 0, loading: true });

  useEffect(() => {
    Promise.all([
      fetch("/api/catalog/plans").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/v1/feature-flags").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([plansData, flagsData]) => {
        const plans: Array<{ status: string; chainSyncStatus: string }> =
          Array.isArray(plansData?.plans)
            ? plansData.plans
            : Array.isArray(plansData)
              ? plansData
              : [];
        setPrereqs({
          publishedPlans: plans.filter((p) => p.status === "PUBLISHED").length,
          onChainPlans: plans.filter(
            (p) => p.chainSyncStatus === "SYNCED",
          ).length,
          featureFlags: Array.isArray(flagsData?.data)
            ? flagsData.data.length
            : 0,
          loading: false,
        });
      })
      .catch(() =>
        setPrereqs((p) => ({ ...p, loading: false })),
      );
  }, []);

  // Load components from server on mount
  useEffect(() => {
    fetch("/api/v1/components")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.data) return;
        const loaded: ComponentConfig[] = (
          data.data as Array<{
            id: string;
            name: string;
            elements: unknown;
            design: unknown;
            createdAt: string;
            updatedAt: string;
          }>
        ).map((c) => {
          const savedDesign =
            c.design && typeof c.design === "object" && !Array.isArray(c.design)
              ? (c.design as Record<string, unknown>)
              : {};
          return {
            id: c.id,
            name: c.name,
            description: "",
            type: "custom" as const,
            category: "Custom",
            elements: Array.isArray(c.elements)
              ? (c.elements as ComponentConfig["elements"])
              : [],
            styling: normalizeComponentStyling(savedDesign),
            template: "blank",
            createdAt: new Date(c.createdAt),
            updatedAt: new Date(c.updatedAt),
          };
        });
        setCustomComponents(loaded);
      })
      .catch(() => {});
  }, []);

  const filteredComponents = customComponents.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleOpenComponent = (component: ComponentConfig) => {
    setSelectedComponent(component);
    setEditorOpen(true);
  };

  const copyComponentId = async (componentId: string) => {
    if (
      typeof navigator === "undefined" ||
      !navigator.clipboard?.writeText
    ) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(componentId);
      return true;
    } catch {
      return false;
    }
  };

  // Called from the modal — build the ComponentConfig and open the editor
  const handleModalCreate = (
    name: string,
    template: "customer-portal" | "blank",
  ) => {
    setShowCreateModal(false);
    const newComponent: ComponentConfig = {
      id: `custom-${Date.now()}`,
      name,
      description:
        template === "customer-portal" ? "Customer billing portal" : "",
      type: "custom",
      category: "Custom",
      elements: template === "customer-portal" ? PORTAL_ELEMENTS : [],
      styling: {
        columns: template === "customer-portal" ? 2 : 1,
        sections: "merged",
        primaryColor: "#000000",
        secondaryColor: "#f5f5f5",
        cardStyle: {
          backgroundColor: "#FFFFFF",
          borderRadius: "10px",
          cardShadow: true,
          cardPadding: "24px",
        },
        typography: { fontFamily: "Inter", fontSize: "14px" },
      },
      template,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSelectedComponent(newComponent);
    setEditorOpen(true);
  };

  const handleSaveComponent = async (component: ComponentConfig) => {
    if (component.type === "custom") {
      const existingIndex = customComponents.findIndex(
        (c) => c.id === component.id,
      );
      const isNew = existingIndex < 0;
      try {
        if (isNew) {
          const res = await fetch("/api/v1/components", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: component.name,
              elements: component.elements,
              design: component.styling,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const createdId =
              typeof data?.data?.id === "string" ? data.data.id : component.id;
            setCustomComponents((prev) => [
              ...prev,
              { ...component, id: createdId },
            ]);
            const copied = await copyComponentId(createdId);
            toast.success(
              copied
                ? "Component created and ID copied"
                : "Component created",
            );
            if (!copied) {
              toast.message(`Component ID: ${createdId}`);
            }
            setEditorOpen(false);
            setSelectedComponent(null);
          } else {
            const err = await res.json().catch(() => ({}));
            toast.error(err?.error ?? "Failed to create component");
          }
        } else {
          const res = await fetch(`/api/v1/components/${component.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: component.name,
              elements: component.elements,
              design: component.styling,
            }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => null);
            const next = [...customComponents];
            next[existingIndex] = {
              ...component,
              updatedAt: data?.data?.updatedAt
                ? new Date(data.data.updatedAt)
                : new Date(),
            };
            setCustomComponents(next);
            toast.success("Component saved");
            setEditorOpen(false);
            setSelectedComponent(null);
          } else {
            const err = await res.json().catch(() => ({}));
            toast.error(err?.error ?? "Failed to save component");
          }
        }
      } catch {
        toast.error("Network error — component was not saved");
      }
    }
  };

  const handleDeleteComponent = async (id: string) => {
    try {
      const res = await fetch(`/api/v1/components/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to delete component");
      }
      setCustomComponents(customComponents.filter((c) => c.id !== id));
      toast.success("Component deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete component",
      );
    }
  };

  const handleDuplicateComponent = (component: ComponentConfig) => {
    const dup: ComponentConfig = {
      ...component,
      id: `custom-${Date.now()}`,
      name: `${component.name} (Copy)`,
      type: "custom",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setSelectedComponent(dup);
    setEditorOpen(true);
  };

  if (editorOpen && selectedComponent) {
    return (
      <ComponentEditor
        component={selectedComponent}
        onClose={() => {
          setEditorOpen(false);
          setSelectedComponent(null);
        }}
        onSave={handleSaveComponent}
      />
    );
  }

  return (
    <>
      {showCreateModal && (
        <CreateComponentModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleModalCreate}
        />
      )}

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Build drop-in billing portals for your users — stablecoin payments
            on any chain.
          </p>
          <Button
            className="flex items-center gap-2"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="w-4 h-4" />
            Create Component
          </Button>
        </div>

        {/* Prerequisite banner */}
        {!prereqs.loading &&
          (prereqs.publishedPlans === 0 || prereqs.featureFlags === 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                    Complete setup to unlock components
                  </p>
                  <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                    {prereqs.publishedPlans === 0 && (
                      <li>
                        •{" "}
                        {onSectionChange ? (
                          <button
                            className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                            onClick={() => onSectionChange("catalog-plans")}
                          >
                            Create and publish at least one plan
                          </button>
                        ) : (
                          "Create and publish at least one plan"
                        )}
                        {prereqs.onChainPlans === 0 &&
                          prereqs.publishedPlans === 0 &&
                          " (then register it on-chain for stablecoin billing)"}
                      </li>
                    )}
                    {prereqs.publishedPlans > 0 &&
                      prereqs.onChainPlans === 0 && (
                        <li>
                          •{" "}
                          {onSectionChange ? (
                            <button
                              className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                              onClick={() => onSectionChange("catalog-plans")}
                            >
                              Register your plans on-chain
                            </button>
                          ) : (
                            "Register your plans on-chain"
                          )}{" "}
                          for stablecoin billing to work
                        </li>
                      )}
                    {prereqs.featureFlags === 0 && (
                      <li>
                        •{" "}
                        {onSectionChange ? (
                          <button
                            className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
                            onClick={() => onSectionChange("feature-flags")}
                          >
                            Configure at least one feature flag
                          </button>
                        ) : (
                          "Configure at least one feature flag"
                        )}{" "}
                        to power entitlements in embedded components
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}

        {/* Search */}
        {customComponents.length > 0 && (
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search components…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-all"
            />
          </div>
        )}

        {/* Components Grid */}
        {filteredComponents.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px] font-semibold">
                {filteredComponents.length} component
                {filteredComponents.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-400">
              {filteredComponents.map((component, index) => (
                <div
                  key={component.id}
                  className="group bg-card border border-border rounded-xl overflow-hidden hover:border-foreground/20 hover:shadow-sm transition-all duration-200 cursor-pointer animate-in fade-in"
                  style={{
                    animationDelay: `${index * 40}ms`,
                    animationFillMode: "both",
                  }}
                  onClick={() => handleOpenComponent(component)}
                >
                  {/* Preview area */}
                  <div className="border-b border-border bg-gray-50 h-36 overflow-hidden relative">
                    {component.elements.length === 0 ? (
                      <div className="w-full h-full flex items-center justify-center">
                        <BlankThumbnail />
                      </div>
                    ) : (
                      <PortalThumbnail />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-background/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  {/* Info */}
                  <div className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-foreground tracking-tight truncate">
                        {component.name}
                      </h3>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0">
                        <button
                          title="Duplicate"
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateComponent(component);
                          }}
                        >
                          <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                        </button>
                        <button
                          title="Delete"
                          className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-destructive/10 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteComponent(component.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {component.elements.length === 0
                        ? "Empty"
                        : `${component.elements.length} element${component.elements.length !== 1 ? "s" : ""}`}{" "}
                      · {component.updatedAt.toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!searchQuery && customComponents.length === 0 && (
          <div className="border-2 border-dashed border-border rounded-2xl">
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-16 h-16 rounded-2xl bg-secondary border border-border flex items-center justify-center mb-4">
                <Layers className="w-7 h-7 text-muted-foreground/50" />
              </div>
              <h3 className="text-base font-bold text-foreground tracking-tight mb-2">
                No components yet
              </h3>
              <p className="text-sm text-muted-foreground max-w-xs mb-6 leading-relaxed">
                Create your first billing component. Start with the Customer
                Portal template or build from scratch.
              </p>
              <Button
                onClick={() => setShowCreateModal(true)}
                className="gap-2"
              >
                <Plus className="w-4 h-4" />
                Create Component
              </Button>
            </div>
          </div>
        )}

        {/* No results */}
        {searchQuery && filteredComponents.length === 0 && (
          <div className="bg-card border border-border rounded-xl">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Search className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-foreground mb-1">
                No components found
              </p>
              <p className="text-xs text-muted-foreground">
                Try a different search term
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
