"use client";
import { apiFetch } from "@/lib/api-client";

import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ArcenEmbed, renderElement, getDesignTokens } from "@arcenpay/react";
import type {
  ComponentRenderData,
  ComponentDesign,
} from "@arcenpay/internal-core";
import type { ComponentElement as SdkComponentElement } from "@arcenpay/internal-core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  GripVertical,
  Trash2,
  Plus,
  Code2,
  Eye,
  Download,
  Save,
  X,
  Layers,
  ReceiptText,
  BarChart3,
  ShieldCheck,
  FileText,
  Clock,
  Shield,
  Copy,
  Check,
  Palette,
  ChevronUp,
  ChevronDown,
  LayoutTemplate,
  Gauge,
  ArrowUpDown,
  Users,
  Zap,
  CreditCard,
  MinusCircle,
  Type,
  Square,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================
// Types
// ============================================================

/** Real provider data surfaced inside element previews */
export interface RealPlan {
  id: string;
  name: string;
  price: number;
  billingInterval: string;
  tier?: string;
  description?: string;
  acceptedToken?: string;
  metadata?: Record<string, unknown> | null;
}

export interface RealFlag {
  featureKey: string;
  name: string;
  featureType?: string;
  defaultValue?: boolean;
  icon?: string | null;
  limit?: number;
  usage?: number;
  unitSingular?: string | null;
  unitPlural?: string | null;
}

export interface RealData {
  plans: RealPlan[];
  flags: RealFlag[];
  activePlan?: Record<string, unknown> | null;
  usage?: Array<Record<string, unknown>>;
}

export interface ComponentElement {
  id: string;
  type: string;
  label: string;
  icon: LucideIcon;
  props: Record<string, any>;
}

export interface ComponentConfig {
  id: string;
  name: string;
  description: string;
  type: "sdk" | "custom";
  category?: string;
  elements: ComponentElement[];
  styling: {
    columns: number;
    sections: "merged" | "separate";
    primaryColor: string;
    secondaryColor: string;
    cardStyle: {
      backgroundColor: string;
      borderRadius: string;
      cardShadow: boolean;
      cardPadding: string;
    };
    typography: {
      fontFamily: string;
      fontSize: string;
    };
  };
  template: string;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Element Library — organized by billing domain
// ============================================================

const ELEMENT_LIBRARY: {
  category: string;
  elements: Omit<ComponentElement, "id" | "props">[];
}[] = [
  {
    category: "Entitlements",
    elements: [
      { type: "plan-manager", label: "Current Plan", icon: ArrowUpDown },
      {
        type: "included-features",
        label: "Included Features",
        icon: ShieldCheck,
      },
      { type: "metered-features", label: "Metered Features", icon: Gauge },
    ],
  },
  {
    category: "Billing",
    elements: [
      { type: "next-bill-due", label: "Next Bill Due", icon: Clock },
      { type: "payment-method", label: "Payment Methods", icon: CreditCard },
      { type: "invoices", label: "Invoices", icon: ReceiptText },
      { type: "billing-history", label: "Billing History", icon: ReceiptText },
      { type: "unsubscribe", label: "Unsubscribe", icon: MinusCircle },
    ],
  },
  {
    category: "Basics",
    elements: [
      { type: "text", label: "Text", icon: Type },
      { type: "button", label: "Button", icon: Square },
    ],
  },
];

const ALL_ELEMENTS = ELEMENT_LIBRARY.flatMap((cat) => cat.elements);

const EDITOR_TO_SDK_ELEMENT_TYPES: Record<string, string> = {
  "plan-manager": "planManager",
  "included-features": "includedFeatures",
  "metered-features": "meteredFeatures",
  "next-bill-due": "nextBillDue",
  "payment-method": "paymentMethod",
  "billing-history": "billingHistory",
};

const SDK_TO_EDITOR_ELEMENT_TYPES = Object.fromEntries(
  Object.entries(EDITOR_TO_SDK_ELEMENT_TYPES).map(([editorType, sdkType]) => [
    sdkType,
    editorType,
  ]),
) as Record<string, string>;

function toSdkElementType(type: string): string {
  return EDITOR_TO_SDK_ELEMENT_TYPES[type] ?? type;
}

function toEditorElementType(type: string): string {
  return SDK_TO_EDITOR_ELEMENT_TYPES[type] ?? type;
}

/** Resolve the icon for an element — falls back to the library definition if
 *  el.icon is missing/invalid (e.g. after JSON round-trip from the API). */
function resolveElementIcon(el: ComponentElement): LucideIcon {
  if (typeof el.icon === "function") return el.icon;
  const lib = ALL_ELEMENTS.find((e) => e.type === toEditorElementType(el.type));
  return lib?.icon ?? Layers;
}

function normalizeEditorElement(el: ComponentElement): ComponentElement {
  const normalizedType = toEditorElementType(el.type);
  const libElement = ALL_ELEMENTS.find(
    (entry) => entry.type === normalizedType,
  );
  return {
    ...el,
    type: normalizedType,
    label: el.label || libElement?.label || normalizedType,
    icon:
      typeof el.icon === "function"
        ? el.icon
        : (libElement?.icon ??
          resolveElementIcon({ ...el, type: normalizedType })),
  };
}

// ============================================================
// SDK View-state map
// ============================================================

// Primary view state shown for SDK components (no tab navigation for prebuilt)
const SDK_PRIMARY_VIEW: Record<string, string> = {
  "customer-portal": "portal",
  checkout: "plans",
  "pricing-table": "plans",
  "plan-manager": "active",
  "checkout-modal": "plans",
};

const COMPONENT_VIEWS: Record<string, { id: string; label: string }[]> = {
  "customer-portal": [
    { id: "portal", label: "Portal" },
    { id: "checkout", label: "Checkout" },
    { id: "payment-method", label: "Wallet" },
    { id: "unsubscribe", label: "Unsubscribe" },
    { id: "disabled", label: "Disabled" },
  ],
  checkout: [
    { id: "plans", label: "Plans" },
    { id: "checkout", label: "Checkout" },
    { id: "success", label: "Success" },
  ],
  "pricing-table": [
    { id: "plans", label: "Plans" },
    { id: "disabled", label: "Disabled" },
  ],
  "plan-manager": [
    { id: "active", label: "Active" },
    { id: "upgrade", label: "Upgrade" },
  ],
  "checkout-modal": [
    { id: "plans", label: "Plans" },
    { id: "checkout", label: "Checkout" },
    { id: "success", label: "Success" },
  ],
};

// ============================================================
// Templates
// ============================================================

const TEMPLATES = [
  {
    id: "customer-portal",
    name: "Customer Portal",
    description:
      "All in one. Let users upgrade/downgrade and view plan, usage, and billing.",
    elements: ["plan-manager", "next-bill-due", "payment-method", "invoices"],
  },
  {
    id: "checkout",
    name: "Checkout",
    description: "Simple checkout flow with plan selection and payment.",
    elements: ["pricing-table", "payment-method"],
  },
  {
    id: "usage-portal",
    name: "Usage Portal",
    description: "Track feature usage and limits with detailed analytics.",
    elements: ["usage-dashboard", "metered-features", "subscription-status"],
  },
  {
    id: "blank",
    name: "Blank",
    description: "Start from scratch. Use only the elements you need.",
    elements: [],
  },
];

// ============================================================
// Realistic element preview renderers
// ============================================================

function ElementPreview({
  type,
  elementProps,
  onChangePlan,
  fullData,
  styling,
}: {
  type: string;
  elementProps?: Record<string, unknown>;
  onChangePlan?: () => void;
  fullData?: ComponentRenderData;
  styling?: {
    primaryColor?: string;
    secondaryColor?: string;
    typography: { fontFamily?: string; fontSize?: string };
    cardStyle: {
      cardShadow?: boolean;
      borderRadius?: string;
      backgroundColor?: string;
      cardPadding?: string;
    };
  };
  // Legacy props kept for compatibility but no longer used
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  realData?: unknown;
}) {
  if (fullData && styling) {
    const design: ComponentDesign = {
      primaryColor: styling.primaryColor ?? "#000000",
      fontFamily: styling.typography.fontFamily ?? "system-ui, sans-serif",
      fontSize: parseFloat(styling.typography.fontSize || "14") || 14,
      fontColor: "#111827",
      backgroundColor: styling.cardStyle.backgroundColor || "#ffffff",
      borderRadius: parseFloat(styling.cardStyle.borderRadius || "8") || 8,
      cardStyle: (styling.cardStyle.cardShadow
        ? "elevated"
        : "minimal") as ComponentDesign["cardStyle"],
    };
    const tokens = getDesignTokens(design);

    const el = {
      type: toSdkElementType(type),
      ...elementProps,
    } as SdkComponentElement & Record<string, unknown>;
    const result = renderElement(
      el,
      0,
      fullData,
      tokens,
      onChangePlan ?? (() => {}),
      () => {},
      () => {},
    );
    return result ? (
      <>{result}</>
    ) : (
      <div style={{ color: tokens.mutedColor, fontSize: 12, padding: "8px 0" }}>
        No preview for this element type.
      </div>
    );
  }

  // Fallback: bare-bones placeholder when fullData not provided
  return (
    <div style={{ padding: "12px 0", color: "#6b7280", fontSize: 13 }}>
      {type} element
    </div>
  );
}

// ============================================================
// LEGACY ElementPreview implementation (kept below for reference, unreachable)
// ============================================================

function ElementPreviewLegacy({
  type,
  primaryColor,
  secondaryColor,
  fontFamily,
  realData,
  elementProps,
  onChangePlan,
}: {
  type: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  realData?: RealData;
  elementProps?: Record<string, unknown>;
  onChangePlan?: () => void;
}) {
  const accent = primaryColor || "#000000";
  const secBg = secondaryColor || "#f5f5f5";
  const font = fontFamily || "inherit";

  // Use real plans/flags when available, fall back to demo placeholders
  const previewPlans: Array<{
    name: string;
    price: number;
    billingInterval: string;
    acceptedToken: string;
  }> = realData?.plans?.length
    ? realData.plans.slice(0, 3).map((p) => ({
        name: p.name,
        price: p.price,
        billingInterval: p.billingInterval,
        acceptedToken: p.acceptedToken ?? "USDC",
      }))
    : [
        {
          name: "Starter",
          price: 9,
          billingInterval: "monthly",
          acceptedToken: "USDC",
        },
        {
          name: "Pro",
          price: 29,
          billingInterval: "monthly",
          acceptedToken: "USDC",
        },
        {
          name: "Enterprise",
          price: 99,
          billingInterval: "monthly",
          acceptedToken: "USDC",
        },
      ];

  const previewFlags = realData?.flags?.length
    ? realData.flags.slice(0, 4)
    : null; // null = no real data yet, show skeletons

  const firstPlan = previewPlans[0];
  const hasRealPlans = (realData?.plans?.length ?? 0) > 0;
  const hasRealFlags = (realData?.flags?.length ?? 0) > 0;

  switch (type) {
    case "pricing-table": {
      const demoPlans = previewPlans;
      return (
        <div className="space-y-2">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${demoPlans.length}, 1fr)` }}
          >
            {demoPlans.map((plan, i) => (
              <div
                key={i}
                className="rounded-lg border p-3 space-y-2"
                style={{
                  borderColor: i === 1 ? (accent ?? undefined) : undefined,
                  backgroundColor:
                    i === 1 && accent ? `${accent}08` : undefined,
                }}
              >
                <p className="text-[10px] font-semibold text-foreground truncate">
                  {plan.name}
                </p>
                <p className="text-sm font-bold text-foreground">
                  ${plan.price}
                  <span className="text-[9px] font-normal text-muted-foreground">
                    /{plan.billingInterval === "yearly" ? "yr" : "mo"}
                  </span>
                </p>
                <div className="space-y-1">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="flex items-center gap-1">
                      <div
                        className="w-2 h-2 rounded-full flex items-center justify-center"
                        style={{
                          backgroundColor: accent ? `${accent}30` : undefined,
                        }}
                      />
                      <div className="h-1 flex-1 rounded bg-foreground/8" />
                    </div>
                  ))}
                </div>
                <div
                  className={cn(
                    "h-5 rounded text-[8px] font-medium flex items-center justify-center",
                    i !== 1 && "bg-secondary text-muted-foreground",
                  )}
                  style={
                    i === 1
                      ? { backgroundColor: accent ?? undefined, color: "#fff" }
                      : undefined
                  }
                >
                  {i === 1 ? "Current Plan" : "Select"}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "plan-manager": {
      if (realData && !hasRealPlans) {
        return (
          <div
            className="flex flex-col items-center justify-center py-4 gap-1.5 opacity-50"
            style={{ fontFamily: font }}
          >
            <p className="text-xs font-semibold text-foreground">
              No plans configured
            </p>
            <p className="text-[10px] text-muted-foreground">
              Create and publish a plan first
            </p>
          </div>
        );
      }
      return (
        <div className="space-y-3" style={{ fontFamily: font }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-bold text-foreground tracking-tight">
                {firstPlan.name}
              </p>
              {firstPlan.price === 0 ? (
                <p className="text-xs text-muted-foreground mt-0.5">
                  Free plan
                </p>
              ) : (
                <div className="flex items-baseline gap-1 mt-1">
                  <span className="text-sm font-bold text-foreground">
                    ${firstPlan.price.toFixed(2)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    /{firstPlan.billingInterval === "yearly" ? "yr" : "mo"} ·
                    USDC
                  </span>
                </div>
              )}
            </div>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: accent
                  ? `${accent}15`
                  : "hsl(var(--secondary))",
                color: accent ?? "hsl(var(--muted-foreground))",
              }}
            >
              Active
            </span>
          </div>
          <button
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-colors"
            style={{
              backgroundColor: accent ?? "hsl(var(--foreground))",
              color: "#fff",
            }}
            onClick={(e) => {
              e.stopPropagation();
              onChangePlan?.();
            }}
          >
            Change Plan
          </button>
        </div>
      );
    }

    case "included-features": {
      if (realData && !hasRealFlags) {
        return (
          <div
            className="flex flex-col items-center justify-center py-4 gap-1.5 opacity-50"
            style={{ fontFamily: font }}
          >
            <p className="text-xs font-semibold text-foreground">
              No features selected
            </p>
            <p className="text-[10px] text-muted-foreground">
              Configure feature flags first
            </p>
          </div>
        );
      }
      // Only show boolean flags (featureType === "boolean" or undefined)
      const booleanFlags = previewFlags
        ? previewFlags.filter(
            (f) => !f.featureType || f.featureType === "boolean",
          )
        : null;
      const feats = booleanFlags
        ? booleanFlags.map((f) => ({
            name: f.name,
            enabled: f.defaultValue ?? true,
          }))
        : [
            { name: "API Access", enabled: true },
            { name: "Webhooks", enabled: true },
            { name: "Custom Domain", enabled: false },
            { name: "SSO", enabled: false },
          ];
      return (
        <div style={{ fontFamily: font }}>
          <p className="text-sm font-bold text-foreground mb-3">
            Included Features
          </p>
          <div className="space-y-2">
            {feats.map((f, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-foreground">{f.name}</span>
                <div
                  className="w-8 h-4 rounded-full relative transition-colors"
                  style={{
                    backgroundColor: f.enabled
                      ? (accent ?? "hsl(var(--foreground))")
                      : "hsl(var(--secondary))",
                  }}
                >
                  <div
                    className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all"
                    style={{ [f.enabled ? "right" : "left"]: "2px" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "metered-features": {
      if (realData && !hasRealFlags) {
        return (
          <div
            className="flex flex-col items-center justify-center py-4 gap-1.5 opacity-50"
            style={{ fontFamily: font }}
          >
            <p className="text-xs font-semibold text-foreground">
              No metered features
            </p>
            <p className="text-[10px] text-muted-foreground">
              Configure event-based flags first
            </p>
          </div>
        );
      }
      // Only show event_based flags for metered features
      const eventBasedFlags = previewFlags
        ? previewFlags.filter((f) => f.featureType === "event_based")
        : null;
      const meteredItems =
        eventBasedFlags && eventBasedFlags.length > 0
          ? eventBasedFlags.slice(0, 2).map((f, i) => ({
              name: f.name,
              used: i === 0 ? 7500 : 3,
              limit: i === 0 ? 10000 : 10,
              unit: i === 0 ? "" : " GB",
            }))
          : [
              { name: "API Calls", used: 7_500, limit: 10_000, unit: "" },
              { name: "Storage", used: 3.2, limit: 10, unit: " GB" },
            ];
      return (
        <div className="space-y-4">
          {meteredItems.map((m, i) => (
            <div key={i}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {m.name}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {typeof m.used === "number" && m.used > 100
                    ? m.used.toLocaleString()
                    : m.used}
                  {m.unit} / {m.limit}
                  {m.unit}
                </p>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round((m.used / m.limit) * 100)}%`,
                    backgroundColor: accent ?? "hsl(var(--foreground))",
                    opacity: 0.8,
                  }}
                />
              </div>
              <p className="text-[9px] text-muted-foreground mt-0.5">
                {Math.round((m.used / m.limit) * 100)}% used
              </p>
            </div>
          ))}
        </div>
      );
    }

    case "usage-dashboard":
      return (
        <div className="space-y-2" style={{ fontFamily: font }}>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Requests", value: "12.4k" },
              { label: "Avg Latency", value: "45ms" },
              { label: "Success", value: "99.8%" },
            ].map((s, i) => (
              <div key={i} className="text-center p-1 rounded bg-secondary/50">
                <p className="text-[10px] font-bold text-foreground">
                  {s.value}
                </p>
                <p className="text-[7px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-0.5 h-8">
            {[40, 55, 35, 70, 60, 80, 65, 90, 75, 85, 70, 95].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  backgroundColor: accent,
                  opacity: 0.25 + (h / 95) * 0.5,
                }}
              />
            ))}
          </div>
        </div>
      );

    case "next-bill-due": {
      const nbdPlan = firstPlan;
      const nbdPrice = nbdPlan
        ? nbdPlan.price === 0
          ? "Free"
          : `$${nbdPlan.price.toFixed(2)}`
        : "$29.00";
      const nbdToken = nbdPlan?.acceptedToken ?? "USDC";
      return (
        <div className="space-y-3" style={{ fontFamily: font }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-foreground">Next Bill Due</p>
            <span className="text-[10px] text-muted-foreground">
              in 12 days
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground tracking-tight">
                {nbdPrice}
              </span>
              {nbdPlan?.price !== 0 ? (
                <span className="text-xs text-muted-foreground">
                  {nbdToken}
                </span>
              ) : null}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Estimated bill · Mar 1 – Mar 31
            </p>
          </div>
          <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full w-[60%]"
              style={{
                backgroundColor: accent ?? "hsl(var(--foreground))",
                opacity: 0.7,
              }}
            />
          </div>
        </div>
      );
    }

    case "payment-method":
      return (
        <div className="space-y-2" style={{ fontFamily: font }}>
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/20">
            <div className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center border border-border">
              <span style={{ fontSize: 14 }}>⬡</span>
            </div>
            <div className="flex-1">
              <p className="text-[9px] font-medium text-foreground font-mono">
                0x4a2f…8c3d
              </p>
              <p className="text-[8px] text-muted-foreground">Base · USDC</p>
            </div>
            <Badge
              variant="secondary"
              className="text-[7px] h-3.5 bg-secondary text-muted-foreground"
            >
              Default
            </Badge>
          </div>
          <div className="h-5 rounded border border-dashed border-border flex items-center justify-center gap-1 text-muted-foreground">
            <Plus className="w-2.5 h-2.5" />
            <span className="text-[8px]">Connect wallet</span>
          </div>
        </div>
      );

    case "invoices":
      return (
        <div style={{ fontFamily: font }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-foreground">Invoices</p>
            <span className="text-[10px] text-muted-foreground">View all</span>
          </div>
          <div className="space-y-2">
            {[
              {
                id: "INV-003",
                date: "Mar 1, 2025",
                amount: "$29.00 USDC",
                status: "Paid",
              },
              {
                id: "INV-002",
                date: "Feb 1, 2025",
                amount: "$29.00 USDC",
                status: "Paid",
              },
              {
                id: "INV-001",
                date: "Jan 1, 2025",
                amount: "$9.00 USDC",
                status: "Paid",
              },
            ].map((inv, i) => (
              <div
                key={i}
                className="flex items-center justify-between py-1.5 border-b border-border last:border-0"
              >
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {inv.id}
                  </p>
                  <p className="text-[9px] text-muted-foreground">{inv.date}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-foreground">
                    {inv.amount}
                  </p>
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "unsubscribe": {
      const unsubPlan = firstPlan;
      const unsubPlanName = unsubPlan?.name ?? "Pro Plan";
      return (
        <div className="space-y-3" style={{ fontFamily: font }}>
          <div className="flex flex-col items-center gap-2 py-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "hsl(var(--destructive) / 0.1)" }}
            >
              <MinusCircle
                className="w-5 h-5"
                style={{ color: "hsl(var(--destructive))" }}
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-foreground">
                Cancel Subscription
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                You are currently on{" "}
                <span className="font-semibold">{unsubPlanName}</span>
              </p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            Your access will continue until the end of the current billing
            period.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="h-7 rounded-lg border border-border flex items-center justify-center text-[10px] font-medium text-muted-foreground cursor-pointer">
              Keep Plan
            </div>
            <div
              className="h-7 rounded-lg flex items-center justify-center text-[10px] font-semibold text-white cursor-pointer"
              style={{ backgroundColor: "hsl(var(--destructive))" }}
            >
              Cancel
            </div>
          </div>
        </div>
      );
    }

    case "text": {
      const txtHeading = elementProps?.heading
        ? String(elementProps.heading)
        : "Your heading here";
      const txtBody = elementProps?.body
        ? String(elementProps.body)
        : "Add your custom text content here. Use this block to provide information, instructions, or any message to your users.";
      const txtAlign = (elementProps?.alignment as string) || "left";
      return (
        <div
          className="space-y-2"
          style={{
            fontFamily: font,
            textAlign: txtAlign as React.CSSProperties["textAlign"],
          }}
        >
          <p className="text-base font-bold text-foreground">{txtHeading}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {txtBody}
          </p>
        </div>
      );
    }

    case "button": {
      const btnLabel = elementProps?.label
        ? String(elementProps.label)
        : "Click Me";
      const btnVariant = (elementProps?.variant as string) || "filled";
      const btnFullWidth = Boolean(elementProps?.fullWidth);
      return (
        <div
          className="flex flex-col items-start gap-2"
          style={{ fontFamily: font }}
        >
          <button
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90${btnFullWidth ? " w-full" : ""}`}
            style={
              btnVariant === "filled"
                ? {
                    backgroundColor: accent ?? "hsl(var(--foreground))",
                    color: "#fff",
                  }
                : btnVariant === "outlined"
                  ? {
                      border: `2px solid ${accent ?? "hsl(var(--foreground))"}`,
                      color: accent ?? "hsl(var(--foreground))",
                      background: "transparent",
                    }
                  : {
                      color: accent ?? "hsl(var(--foreground))",
                      background: "transparent",
                    }
            }
          >
            {btnLabel}
          </button>
          {!elementProps?.label && (
            <p className="text-[10px] text-muted-foreground">
              Customise label & action in settings
            </p>
          )}
        </div>
      );
    }

    case "checkout-modal": {
      const cmPlan = firstPlan;
      const cmPlanName = cmPlan?.name ?? "Pro Plan";
      const cmPlanPrice = cmPlan
        ? cmPlan.price === 0
          ? "Free"
          : `$${cmPlan.price.toFixed(2)}`
        : "$29";
      const cmBillingLabel =
        cmPlan && cmPlan.price > 0
          ? `/${cmPlan.billingInterval === "yearly" ? "yr" : "mo"}`
          : "";
      const cmToken = cmPlan?.acceptedToken ?? "USDC";
      const steps = ["Wallet", "Approve", "Subscribe"];
      const activeStep = 1;
      return (
        <div className="space-y-2" style={{ fontFamily: font }}>
          <div className="rounded-lg border border-border bg-card p-2.5 space-y-2.5 shadow-sm">
            {/* Modal header */}
            <div className="flex items-center justify-between pb-1.5 border-b border-border">
              <span className="text-[10px] font-semibold text-foreground">
                Subscribe to {cmPlanName}
              </span>
              <div className="w-3.5 h-3.5 rounded-full bg-secondary flex items-center justify-center text-[8px] text-muted-foreground cursor-pointer">
                ✕
              </div>
            </div>
            {/* Step bar */}
            <div className="flex items-center gap-0.5">
              {steps.map((step, i) => (
                <React.Fragment key={i}>
                  <div
                    className="flex items-center justify-center w-4 h-4 rounded-full text-[7px] font-bold shrink-0"
                    style={{
                      backgroundColor:
                        i <= activeStep ? accent : "hsl(var(--secondary))",
                      color:
                        i <= activeStep
                          ? "#fff"
                          : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {i < activeStep ? "✓" : i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className="h-0.5 flex-1"
                      style={{
                        backgroundColor:
                          i < activeStep ? accent : "hsl(var(--border))",
                      }}
                    />
                  )}
                </React.Fragment>
              ))}
            </div>
            {/* Plan + wallet */}
            <div
              className="flex items-center justify-between p-1.5 rounded-md border border-border"
              style={{ backgroundColor: secBg + "40" }}
            >
              <div>
                <p className="text-[8px] text-muted-foreground">
                  Subscribing to
                </p>
                <p className="text-[9px] font-semibold text-foreground">
                  {cmPlanName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-foreground">
                  {cmPlanPrice}
                  <span className="text-[7px] font-normal text-muted-foreground">
                    {cmBillingLabel}
                  </span>
                </p>
                <p className="text-[7px] text-muted-foreground">{cmToken}</p>
              </div>
            </div>
            {/* Wallet connected */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-secondary/30 border border-border">
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${accent}20` }}
              >
                <Check className="w-2.5 h-2.5" style={{ color: accent }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] text-muted-foreground">Wallet</p>
                <p className="text-[8px] font-mono text-foreground truncate">
                  0x4a2f…8c3d · Base
                </p>
              </div>
            </div>
            {/* CTA */}
            <div
              className="h-6 rounded-md text-[8px] font-semibold flex items-center justify-center text-white"
              style={{ backgroundColor: accent }}
            >
              Approve &amp; Subscribe
            </div>
          </div>
        </div>
      );
    }

    case "billing-history":
      return (
        <div style={{ fontFamily: font }}>
          <p className="text-sm font-bold text-foreground mb-3">
            Billing History
          </p>
          <div className="space-y-2">
            {[
              {
                icon: "◎",
                label: "Subscription minted",
                date: "Mar 1",
                amount: "+1 NFT",
              },
              {
                icon: "↻",
                label: "Renewed — $29.00",
                date: "Feb 1",
                amount: "USDC",
              },
              {
                icon: "↻",
                label: "Renewed — $9.00",
                date: "Jan 1",
                amount: "USDC",
              },
            ].map((ev, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 py-1.5 border-b border-border last:border-0"
              >
                <span className="text-sm shrink-0 w-5 text-center text-foreground/60">
                  {ev.icon}
                </span>
                <span className="text-xs text-foreground flex-1">
                  {ev.label}
                </span>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground">{ev.date}</p>
                  <p className="text-[9px] text-muted-foreground">
                    {ev.amount}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "subscription-status":
      return (
        <div className="space-y-2" style={{ fontFamily: font }}>
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: accent }}
            />
            <span className="text-[10px] font-semibold text-foreground">
              Active Subscription
            </span>
          </div>
          <div className="p-2 rounded-lg bg-secondary/30 space-y-1">
            <div className="flex justify-between">
              <span className="text-[9px] text-muted-foreground">Plan</span>
              <span className="text-[9px] font-medium text-foreground">
                Pro
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] text-muted-foreground">Since</span>
              <span className="text-[9px] text-foreground">Jan 15, 2024</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[9px] text-muted-foreground">Renews</span>
              <span className="text-[9px] text-foreground">Apr 15, 2024</span>
            </div>
          </div>
        </div>
      );

    default:
      return (
        <div className="flex items-center justify-center h-full">
          <span className="text-xs text-muted-foreground">Preview</span>
        </div>
      );
  }
}

// ============================================================
// Element Mini Preview — tiny wireframe thumbnails for library
// ============================================================

function ElementMiniPreview({ type }: { type: string }) {
  switch (type) {
    case "pricing-table":
      return (
        <div className="flex gap-1 px-2 scale-[0.85]">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                "flex-1 rounded p-1 space-y-0.5",
                i === 1 ? "bg-accent/20" : "bg-background/70",
              )}
            >
              <div className="h-1 w-3/4 rounded bg-foreground/20" />
              <div className="h-2 w-1/2 rounded bg-foreground/30" />
              {[0, 1, 2].map((j) => (
                <div
                  key={j}
                  className="h-0.5 w-full rounded bg-foreground/10 mt-0.5"
                />
              ))}
              <div
                className={cn(
                  "h-2 rounded mt-0.5",
                  i === 1 ? "bg-accent/60" : "bg-foreground/10",
                )}
              />
            </div>
          ))}
        </div>
      );
    case "plan-manager":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          <div className="flex items-center justify-between">
            <div className="h-2 w-1/3 rounded bg-foreground/30" />
            <div className="h-1.5 w-10 rounded-full bg-accent/40" />
          </div>
          <div className="h-px bg-foreground/10" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-accent/40" />
              <div className="h-1 flex-1 rounded bg-foreground/10" />
            </div>
          ))}
          <div className="flex gap-1 mt-1">
            <div className="flex-1 h-2.5 rounded bg-foreground/10" />
            <div className="flex-1 h-2.5 rounded bg-accent/40" />
          </div>
        </div>
      );
    case "included-features":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-1 w-2/3 rounded bg-foreground/15" />
              <div
                className={cn(
                  "w-4 h-2 rounded-full",
                  i < 2 ? "bg-accent/50" : "bg-foreground/10",
                )}
              />
            </div>
          ))}
        </div>
      );
    case "metered-features":
      return (
        <div className="w-full px-3 space-y-1.5 scale-[0.85]">
          {[0.75, 0.45, 0.9].map((pct, i) => (
            <div key={i} className="space-y-0.5">
              <div className="h-1 w-1/2 rounded bg-foreground/15" />
              <div className="h-1.5 w-full rounded-full bg-foreground/10">
                <div
                  className="h-full rounded-full bg-accent/50"
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      );
    case "usage-dashboard":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          <div className="grid grid-cols-3 gap-1 mb-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-4 rounded bg-foreground/10 flex flex-col items-center justify-center gap-0.5"
              >
                <div className="h-1.5 w-3/4 rounded bg-foreground/20" />
                <div className="h-1 w-1/2 rounded bg-foreground/10" />
              </div>
            ))}
          </div>
          <div className="flex items-end gap-0.5 h-5">
            {[50, 70, 40, 80, 60, 90, 65, 75].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-accent/30"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      );
    case "next-bill-due":
      return (
        <div className="w-full px-3 scale-[0.85]">
          <div className="flex justify-between mb-1">
            <div className="h-1 w-2/5 rounded bg-foreground/20" />
            <div className="h-1 w-1/4 rounded bg-foreground/10" />
          </div>
          <div className="h-3 w-1/3 rounded bg-foreground/30 mb-1.5" />
          <div className="h-1.5 rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-accent/50 w-3/5" />
          </div>
        </div>
      );
    case "payment-method":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          <div className="flex items-center gap-1.5 p-1.5 rounded border border-accent/30 bg-accent/5">
            <div className="w-5 h-5 rounded-full bg-foreground/10 flex items-center justify-center text-[8px]">
              ⬡
            </div>
            <div className="flex-1 space-y-0.5">
              <div className="h-1 w-3/4 rounded bg-foreground/20" />
              <div className="h-0.5 w-1/2 rounded bg-foreground/10" />
            </div>
          </div>
          <div className="h-3 rounded border border-dashed border-foreground/15 flex items-center justify-center">
            <div className="h-1 w-1/2 rounded bg-foreground/10" />
          </div>
        </div>
      );
    case "invoices":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1">
          <div className="grid grid-cols-4 gap-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-1 rounded bg-foreground/20" />
            ))}
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-4 gap-1">
              {[0, 1, 2, 3].map((j) => (
                <div key={j} className="h-1 rounded bg-foreground/10" />
              ))}
            </div>
          ))}
        </div>
      );
    case "billing-history":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  i === 0 ? "bg-accent/70" : "bg-foreground/20",
                )}
              />
              <div className="h-1 flex-1 rounded bg-foreground/10" />
              <div className="h-1 w-6 rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      );
    case "subscription-status":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1.5">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-accent/60 animate-pulse" />
            <div className="h-1.5 w-1/2 rounded bg-foreground/20" />
          </div>
          <div className="p-1.5 rounded bg-foreground/5 space-y-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex justify-between">
                <div className="h-1 w-1/3 rounded bg-foreground/10" />
                <div className="h-1 w-1/4 rounded bg-foreground/20" />
              </div>
            ))}
          </div>
        </div>
      );
    case "checkout-modal":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1">
          <div className="flex justify-between mb-0.5">
            <div className="h-1.5 w-2/5 rounded bg-foreground/20" />
            <div className="w-2 h-2 rounded-full bg-foreground/10" />
          </div>
          <div className="flex gap-0.5 items-center">
            {[0, 1, 2, 3, 4].map((i) => (
              <React.Fragment key={i}>
                <div
                  className={cn(
                    "w-3 h-3 rounded-full",
                    i <= 2 ? "bg-accent/60" : "bg-foreground/10",
                  )}
                />
                {i < 4 && (
                  <div
                    className={cn(
                      "h-0.5 flex-1",
                      i < 2 ? "bg-accent/40" : "bg-foreground/10",
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="h-6 rounded bg-foreground/5 border border-foreground/10" />
          <div className="h-3 rounded bg-accent/50" />
        </div>
      );
    case "unsubscribe":
      return (
        <div className="w-full px-3 scale-[0.85] flex flex-col items-center gap-1">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "hsl(var(--destructive) / 0.12)" }}
          >
            <div
              className="w-2 h-0.5 rounded-full"
              style={{ backgroundColor: "hsl(var(--destructive))" }}
            />
          </div>
          <div className="h-1 w-2/3 rounded bg-foreground/20" />
          <div className="h-0.5 w-1/2 rounded bg-foreground/10" />
          <div className="grid grid-cols-2 gap-1 w-full mt-0.5">
            <div className="h-2.5 rounded border border-foreground/15" />
            <div
              className="h-2.5 rounded"
              style={{ backgroundColor: "hsl(var(--destructive) / 0.5)" }}
            />
          </div>
        </div>
      );
    case "text":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1">
          <div className="h-2 w-2/3 rounded bg-foreground/30" />
          <div className="h-1 w-full rounded bg-foreground/10" />
          <div className="h-1 w-4/5 rounded bg-foreground/10" />
          <div className="h-1 w-3/5 rounded bg-foreground/10" />
        </div>
      );
    case "button":
      return (
        <div className="w-full px-3 scale-[0.85] flex items-center justify-start">
          <div className="h-4 w-16 rounded-md bg-accent/70 flex items-center justify-center">
            <div className="h-1 w-8 rounded bg-foreground/50" />
          </div>
        </div>
      );
    default:
      return <div className="w-8 h-8 rounded-lg bg-foreground/10" />;
  }
}

// ============================================================
// Design Panel — right sidebar with collapsible sections
// ============================================================

function DesignSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-0">
      <button
        className="flex items-center justify-between w-full px-4 py-3 text-xs font-semibold text-foreground hover:bg-secondary/30 transition-colors"
        onClick={onToggle}
      >
        {title}
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function DesignRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[28px]">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">{children}</div>
    </div>
  );
}

// ============================================================
// Component Editor
// ============================================================

interface ComponentEditorProps {
  component: ComponentConfig;
  onClose: () => void;
  onSave: (component: ComponentConfig) => void;
}

export function ComponentEditor({
  component,
  onClose,
  onSave,
}: ComponentEditorProps) {
  const [activeView, setActiveView] = useState<"component" | "code">(
    "component",
  );
  const [config, setConfig] = useState<ComponentConfig>(component);
  const [elements, setElements] = useState<ComponentElement[]>(() =>
    component.elements.map(normalizeEditorElement),
  );
  const [draggedElement, setDraggedElement] = useState<ComponentElement | null>(
    null,
  );
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<
    "desktop" | "tablet" | "mobile"
  >("desktop");

  const isCustom = config.type === "custom";

  // ── Live data from the provider (real plans + feature flags) ─────────────
  const [liveData, setLiveData] = useState<RealData | undefined>(undefined);

  function mapLivePlans(rawPlans: Array<Record<string, unknown>>): RealPlan[] {
    return rawPlans
      .map((p) => ({
        id: String(p.id ?? ""),
        name: String(p.name ?? ""),
        price: parseFloat(String(p.price ?? "0")),
        billingInterval:
          Number(p.billingInterval) === 31536000 ? "yearly" : "monthly",
        tier: p.tier ? String(p.tier) : undefined,
        description: p.description ? String(p.description) : undefined,
        acceptedToken: p.acceptedToken ? String(p.acceptedToken) : "USDC",
        metadata:
          p.metadata && typeof p.metadata === "object"
            ? (p.metadata as Record<string, unknown>)
            : null,
      }))
      .sort((a, b) => a.price - b.price);
  }

  async function loadConfiguredLivePlans(): Promise<RealPlan[]> {
    const configRes = await apiFetch("/api/catalog/config");
    if (!configRes.ok) return [];
    const payload = (await configRes.json()) as {
      catalog?: { plans?: Array<Record<string, unknown>> };
      config?: {
        livePlanIds?: string[] | null;
        restrictLivePlans?: boolean | null;
      };
    };

    const rawPlans = Array.isArray(payload.catalog?.plans)
      ? payload.catalog.plans
      : [];
    const configuredIds = Array.isArray(payload.config?.livePlanIds)
      ? payload.config.livePlanIds
      : [];
    const restrictLivePlans = Boolean(payload.config?.restrictLivePlans);
    const filteredPlans =
      !restrictLivePlans
        ? rawPlans
        : configuredIds.length > 0
        ? rawPlans.filter((plan) => configuredIds.includes(String(plan.id ?? "")))
        : [];

    return mapLivePlans(filteredPlans);
  }

  useEffect(() => {
    Promise.all([
      loadConfiguredLivePlans(),
      apiFetch("/api/v1/feature-flags").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([plans, flagsRes]) => {
        const rawFlags: Array<Record<string, unknown>> = Array.isArray(
          flagsRes?.data,
        )
          ? flagsRes.data
          : [];

        const flags: RealFlag[] = rawFlags.map((f) => ({
          featureKey: String(f.featureKey ?? f.key ?? ""),
          name: String(f.name ?? ""),
          featureType: f.featureType ? String(f.featureType) : undefined,
          defaultValue: Boolean(f.defaultValue),
          icon: typeof f.icon === "string" ? f.icon : null,
          unitSingular:
            typeof f.unitSingular === "string" ? f.unitSingular : null,
          unitPlural: typeof f.unitPlural === "string" ? f.unitPlural : null,
        }));

        setLiveData({ plans, flags });
      })
      .catch(() => {
        // Set empty real data so the "no data" states are shown instead of demo
        setLiveData({ plans: [], flags: [] });
      });
  }, []);

  // ── Company selector for preview ─────────────────────────────────────────
  interface PreviewCompany {
    id: string;
    name: string;
    externalId?: string | null;
  }
  const [companies, setCompanies] = useState<PreviewCompany[]>([]);
  const [previewCompanyId, setPreviewCompanyId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/v1/companies")
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        const raw: Array<Record<string, unknown>> = Array.isArray(res?.data)
          ? res.data
          : Array.isArray(res)
            ? res
            : [];
        setCompanies(
          raw.slice(0, 50).map((c) => ({
            id: String(c.id ?? ""),
            name: String(c.name ?? c.id ?? "Unknown"),
            externalId: c.externalId ? String(c.externalId) : null,
          })),
        );
      })
      .catch(() => {
        /* silently ignore */
      });
  }, []);

  async function loadCompanyPreviewData(companyId: string) {
    try {
      const tokenRes = await apiFetch("/api/internal/preview-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, componentId: config.id }),
      });
      if (!tokenRes.ok) return;
      const { token } = await tokenRes.json();

      const renderRes = await apiFetch(`/api/v1/components/${config.id}/render`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!renderRes.ok) return;
      const { data } = await renderRes.json();

      // Map to the liveData format used by ArcenEmbed
      setLiveData({
        plans: (data.plans as Array<Record<string, unknown>>).map((p) => ({
          id: String(p.id ?? ""),
          name: String(p.name ?? ""),
          price: parseFloat(String(p.price ?? "0")),
          billingInterval:
            Number(p.billingInterval) === 31536000 ? "yearly" : "monthly",
          acceptedToken: p.acceptedToken ? String(p.acceptedToken) : "USDC",
          tier: p.tier ? String(p.tier) : undefined,
          description: p.description ? String(p.description) : undefined,
          metadata:
            p.metadata && typeof p.metadata === "object"
              ? (p.metadata as Record<string, unknown>)
              : null,
        })),
        flags: (data.entitlements as Array<Record<string, unknown>>).map(
          (e) => ({
            name: String(e.name ?? e.featureKey ?? ""),
            featureKey: String(e.featureKey ?? ""),
            defaultValue: e.value === true || e.value === "true",
            featureType: e.featureType ? String(e.featureType) : "boolean",
            icon: typeof e.icon === "string" ? e.icon : null,
            limit:
              typeof e.limit === "number"
                ? e.limit
                : typeof e.limit === "string"
                  ? Number(e.limit)
                  : undefined,
            usage:
              typeof e.usage === "number"
                ? e.usage
                : typeof e.usage === "string"
                  ? Number(e.usage)
                  : undefined,
            unitSingular:
              typeof e.unitSingular === "string" ? e.unitSingular : null,
            unitPlural: typeof e.unitPlural === "string" ? e.unitPlural : null,
          }),
        ),
        activePlan: data.activePlan as Record<string, unknown> | null,
        usage: data.usage as Array<Record<string, unknown>>,
      });
      setPreviewCompanyId(companyId);
    } catch (err) {
      console.error("Failed to load company preview data:", err);
    }
  }

  function resetToSampleData() {
    setPreviewCompanyId(null);
    // Re-fetch live data from catalog
    Promise.all([
      loadConfiguredLivePlans(),
      apiFetch("/api/v1/feature-flags").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([plans, flagsRes]) => {
        const rawFlags: Array<Record<string, unknown>> = Array.isArray(
          flagsRes?.data,
        )
          ? flagsRes.data
          : [];
        const flags: RealFlag[] = rawFlags.map((f) => ({
          featureKey: String(f.featureKey ?? f.key ?? ""),
          name: String(f.name ?? ""),
          featureType: f.featureType ? String(f.featureType) : undefined,
          defaultValue: Boolean(f.defaultValue),
          icon: typeof f.icon === "string" ? f.icon : null,
          unitSingular:
            typeof f.unitSingular === "string" ? f.unitSingular : null,
          unitPlural: typeof f.unitPlural === "string" ? f.unitPlural : null,
        }));
        setLiveData({ plans, flags });
      })
      .catch(() => setLiveData({ plans: [], flags: [] }));
  }

  // Both custom AND SDK components use the same view states.
  // Custom components use customer-portal views (Portal = their assembled elements, rest = standard flows).
  // SDK components use their own view map.
  const componentViews = isCustom
    ? COMPONENT_VIEWS["customer-portal"]
    : (COMPONENT_VIEWS[component.id] ??
      COMPONENT_VIEWS[component.template] ??
      COMPONENT_VIEWS["customer-portal"]);

  // Map editor tab IDs → ArcenEmbed view names
  function tabToEmbedView(
    tab: string,
  ): "portal" | "checkout" | "payment" | "unsubscribe" | "success" {
    // Non-custom component view IDs that map to checkout (plan selection flow)
    if (tab === "plans" || tab === "upgrade") return "checkout";
    // plan-manager "active" view — shows the portal-style plan info
    if (tab === "active") return "portal";
    const map: Record<
      string,
      "portal" | "checkout" | "payment" | "unsubscribe" | "success"
    > = {
      portal: "portal",
      checkout: "checkout",
      "payment-method": "payment",
      payment: "payment",
      unsubscribe: "unsubscribe",
      success: "success",
    };
    return map[tab] ?? "portal";
  }

  // Build mock data for ArcenEmbed preview (used for checkout/payment/unsubscribe previews)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const canvasMockData = useMemo((): ComponentRenderData => {
    const sdkPlans: ComponentRenderData["plans"] = liveData?.plans?.length
      ? liveData.plans.slice(0, 4).map((p) => ({
          id: p.id,
          name: p.name,
          tier: p.tier ?? "standard",
          price: String(p.price),
          billingInterval: p.billingInterval === "yearly" ? 31536000 : 2592000,
          description: p.description ?? "",
          acceptedToken: p.acceptedToken,
          metadata: p.metadata ?? null,
        }))
      : [];
    const sdkElementTypes = new Set(
      elements.map((el) => toSdkElementType(el.type)),
    );
    const needsPaidBillingPreview = [
      "planManager",
      "unsubscribe",
      "nextBillDue",
      "paymentMethod",
      "invoices",
      "billingHistory",
    ].some((type) => sdkElementTypes.has(type));
    const syntheticPaidPlan: ComponentRenderData["activePlan"] = {
      id: "preview-paid-plan",
      name: "Starter",
      tier: "starter",
      price: "9",
      billingInterval: 2_592_000,
      description: "Preview paid plan",
      acceptedToken: "USDC",
      metadata: {
        entitlements: [
          {
            featureKey: "api_access",
            featureName: "API access",
            type: "BOOLEAN",
            enabled: true,
            value: true,
          },
        ],
      },
    };
    const firstPaidPlan =
      sdkPlans.find((plan) => Number(plan.price ?? "0") > 0) ?? null;

    const usageMap = new Map(
      (liveData?.usage ?? []).map((item) => [
        String(item.featureKey ?? ""),
        item,
      ]),
    );
    const flagMap = new Map(
      (liveData?.flags ?? []).map((flag) => [flag.featureKey, flag]),
    );
    const readPlanEntitlements = (plan: { metadata?: unknown } | null) => {
      const metadata =
        plan?.metadata && typeof plan.metadata === "object"
          ? (plan.metadata as Record<string, unknown>)
          : null;
      if (Array.isArray(metadata?.entitlements)) {
        return metadata.entitlements;
      }
      const legacyAnnual = (metadata as
        | { annualEntitlements?: unknown[] }
        | null
        | undefined)?.annualEntitlements;
      return Array.isArray(legacyAnnual) ? legacyAnnual : [];
    };
    const readPlanCreditGrants = (plan: { metadata?: unknown } | null) => {
      const metadata =
        plan?.metadata && typeof plan.metadata === "object"
          ? (plan.metadata as Record<string, unknown>)
          : null;
      return Array.isArray(metadata?.creditGrants)
        ? metadata.creditGrants
        : [];
    };
    const preferredPreviewPlan =
      (needsPaidBillingPreview
        ? sdkPlans.find((plan) => {
            const entitlements = readPlanEntitlements(plan);
            const creditGrants = readPlanCreditGrants(plan);
            return (
              (entitlements.length > 0 || creditGrants.length > 0) &&
              Number(plan.price ?? "0") > 0
            );
          }) ??
          firstPaidPlan
        : null) ??
      sdkPlans.find((plan) => {
        const entitlements = readPlanEntitlements(plan);
        const creditGrants = readPlanCreditGrants(plan);
        return entitlements.length > 0 || creditGrants.length > 0;
      }) ??
      firstPaidPlan ??
      sdkPlans[0] ??
      (needsPaidBillingPreview ? syntheticPaidPlan : null);
    const requestedActivePlanId =
      typeof liveData?.activePlan?.id === "string"
        ? String(liveData.activePlan.id)
        : null;
    const activePlan =
      (requestedActivePlanId
        ? sdkPlans.find((plan) => plan.id === requestedActivePlanId) ?? null
        : null) ??
      preferredPreviewPlan;
    const rawPlanEntitlements = readPlanEntitlements(activePlan) as Array<
      Record<string, unknown>
    >;
    const rawPlanCreditGrants = readPlanCreditGrants(activePlan) as Array<
      Record<string, unknown>
    >;
    const planEntitlements: ComponentRenderData["entitlements"] =
      rawPlanEntitlements
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.featureKey === "string" &&
            entry.enabled !== false,
        )
        .map((entry) => {
          const featureKey = String(entry.featureKey);
          const flag = flagMap.get(featureKey);
          const usageEntry = usageMap.get(featureKey);
          const storedType =
            typeof entry.type === "string" ? entry.type : "BOOLEAN";
          const normalizedFeatureType =
            typeof entry.featureType === "string"
              ? entry.featureType
              : storedType === "BOOLEAN"
                ? "boolean"
                : "event_based";
          const rawValue = entry.value;
          const numericValue =
            typeof rawValue === "number"
              ? rawValue
              : typeof rawValue === "string"
                ? Number(rawValue)
                : null;

          return {
            featureKey,
            name:
              (typeof entry.featureName === "string" && entry.featureName) ||
              flag?.name ||
              featureKey,
            value:
              storedType === "BOOLEAN"
                ? entry.enabled !== false && rawValue !== false
                : (numericValue ?? flag?.limit ?? 0),
            featureType: (normalizedFeatureType === "event"
              ? "event_based"
              : normalizedFeatureType) as
              | "boolean"
              | "event_based"
              | "trait_based"
              | "credit",
            limit:
              storedType === "BOOLEAN"
                ? undefined
                : (numericValue ?? flag?.limit),
            usage:
              typeof usageEntry?.used === "number"
                ? usageEntry.used
                : (flag?.usage ?? 0),
            unitSingular:
              (typeof entry.valueUnit === "string" && entry.valueUnit) ||
              flag?.unitSingular ||
              undefined,
            unitPlural: flag?.unitPlural ?? flag?.unitSingular ?? undefined,
            icon:
              (typeof entry.icon === "string" && entry.icon) ||
              flag?.icon ||
              null,
          };
        });
    const planCreditGrantEntitlements: ComponentRenderData["entitlements"] =
      rawPlanCreditGrants
        .filter(
          (entry) =>
            entry &&
            typeof entry === "object" &&
            typeof entry.creditTypeId === "string",
        )
        .map((entry) => {
          const rawAmount =
            typeof entry.amount === "number"
              ? entry.amount
              : Number.parseFloat(String(entry.amount ?? 0));
          const amount = Number.isFinite(rawAmount) ? rawAmount : 0;
          const unitName =
            typeof entry.unitName === "string" && entry.unitName
              ? entry.unitName
              : "credits";
          const creditName =
            (typeof entry.name === "string" && entry.name) ||
            (typeof entry.code === "string" && entry.code) ||
            String(entry.creditTypeId);

          return {
            featureKey: `credit:${typeof entry.code === "string" && entry.code ? entry.code : String(entry.creditTypeId)}`,
            name: creditName,
            value: amount,
            featureType: "credit" as const,
            usage: 0,
            exceeded: false,
            unitSingular: unitName,
            unitPlural: unitName,
            icon: null,
          };
        });
    const fallbackEntitlements: ComponentRenderData["entitlements"] =
      liveData?.flags?.map((f) => ({
        featureKey: f.featureKey,
        name: f.name,
        value: f.defaultValue ?? true,
        featureType: (f.featureType ?? "boolean") as
          | "boolean"
          | "event_based"
          | "trait_based"
          | "credit",
        icon: f.icon ?? null,
        limit: f.limit,
        usage: f.usage ?? 0,
        unitSingular: f.unitSingular ?? undefined,
        unitPlural: f.unitPlural ?? f.unitSingular ?? undefined,
      })) ?? [];
    const previewEntitlements =
      planEntitlements.length > 0 || planCreditGrantEntitlements.length > 0
        ? [...planEntitlements, ...planCreditGrantEntitlements]
        : fallbackEntitlements;

    return {
      component: {
        id: "preview",
        name: "Preview",
        elements: elements.map((el) => ({
          type: toSdkElementType(el.type),
          ...el.props,
        })),
        design: {
          primaryColor: config.styling.primaryColor ?? "#000000",
          secondaryColor: config.styling.secondaryColor ?? "#f3f4f6",
          fontFamily:
            config.styling.typography.fontFamily ?? "system-ui, sans-serif",
          fontSize: config.styling.typography.fontSize
            ? parseFloat(config.styling.typography.fontSize) || 14
            : 14,
          fontColor: "#111827",
          backgroundColor:
            config.styling.cardStyle.backgroundColor || "#ffffff",
          borderRadius: config.styling.cardStyle.borderRadius
            ? parseFloat(config.styling.cardStyle.borderRadius) || 8
            : 8,
          cardStyle: (config.styling.cardStyle.cardShadow
            ? "elevated"
            : "minimal") as ComponentDesign["cardStyle"],
          columns: config.styling.columns ?? 1,
          sections: (config.styling.sections ??
            "separate") as ComponentDesign["sections"],
        } as ComponentDesign,
      },
      company: {
        id: "preview",
        name: "Preview Company",
        walletAddress: "0x1234567890abcdef1234",
      },
      activePlan,
      plans: sdkPlans,
      entitlements: previewEntitlements,
      billingPeriod:
        activePlan?.billingInterval === 31_536_000 ? "annual" : "monthly",
      nextBillingAt:
        activePlan && parseFloat(String(activePlan.price ?? "0")) > 0
          ? "2026-06-16T00:00:00.000Z"
          : null,
      paymentMethod:
        activePlan && parseFloat(String(activePlan.price ?? "0")) > 0
          ? {
              walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
              token: activePlan.acceptedToken ?? "USDC",
              chainId: 5042002,
            }
          : null,
      recentInvoices:
        activePlan && parseFloat(String(activePlan.price ?? "0")) > 0
          ? [
              {
                id: "preview-invoice-1",
                number: "INV-PREVIEW-0001",
                status: "PAID",
                total: activePlan.price,
                currency: "USDC",
                issuedAt: "2026-05-17T00:00:00.000Z",
                paidAt: "2026-05-17T00:00:00.000Z",
                customerName: "Preview Company",
                downloadUrl: "#",
              },
            ]
          : [],
      usage:
        (liveData?.usage?.map((item) => {
          const featureKey = String(item.featureKey ?? "");
          const flag = flagMap.get(featureKey);
          return {
            featureKey,
            name: String(item.name ?? flag?.name ?? featureKey),
            used:
              typeof item.used === "number"
                ? item.used
                : Number(item.used ?? 0),
            limit:
              typeof item.limit === "number"
                ? item.limit
                : item.limit !== undefined
                  ? Number(item.limit)
                  : flag?.limit,
            unitSingular:
              typeof item.unitSingular === "string"
                ? item.unitSingular
                : (flag?.unitSingular ?? null),
            unitPlural:
              typeof item.unitPlural === "string"
                ? item.unitPlural
                : (flag?.unitPlural ?? flag?.unitSingular ?? null),
            icon: flag?.icon ?? null,
          };
        }) as ComponentRenderData["usage"]) ?? [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, config.styling, liveData]);

  const [activeViewState, setActiveViewState] = useState<string>(
    componentViews[0]?.id ?? "portal",
  );
  // Separate mount key so tab clicks force an embed remount with the correct
  // initialView, while internal ArcenEmbed navigation only updates the tab
  // indicator without causing a remount.
  const [embedMountKey, setEmbedMountKey] = useState(0);

  // Collapsible design panel sections
  const [openSections, setOpenSections] = useState({
    general: true,
    cardStyling: false,
    typography: false,
  });
  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  // Element picker (inside design panel for custom components)
  const handleDragStart = (element: Omit<ComponentElement, "id" | "props">) => {
    const newElement: ComponentElement = {
      id: `${element.type}-${Date.now()}`,
      type: element.type,
      label: element.label,
      icon: element.icon,
      props: {},
    };
    setDraggedElement(newElement);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedElement) {
      setElements([...elements, draggedElement]);
      setDraggedElement(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const addElement = (element: Omit<ComponentElement, "id" | "props">) => {
    setElements([
      ...elements,
      {
        id: `${element.type}-${Date.now()}`,
        type: element.type,
        label: element.label,
        icon: element.icon,
        props: {},
      },
    ]);
  };

  const removeElement = (id: string) => {
    setElements(elements.filter((el) => el.id !== id));
    if (selectedElement === id) setSelectedElement(null);
  };

  const moveElement = (index: number, direction: "up" | "down") => {
    const newElements = [...elements];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= elements.length) return;
    [newElements[index], newElements[targetIndex]] = [
      newElements[targetIndex],
      newElements[index],
    ];
    setElements(newElements);
  };

  const moveElementToPosition = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= elements.length || toIndex >= elements.length) return;
    const newElements = [...elements];
    const [moved] = newElements.splice(fromIndex, 1);
    newElements.splice(toIndex, 0, moved);
    setElements(newElements);
  };

  const applyTemplate = (templateId: string) => {
    const template = TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;

    const templateElements: ComponentElement[] = template.elements
      .map((type, i) => {
        const libElement = ALL_ELEMENTS.find((el) => el.type === type);
        if (!libElement) return null;
        return {
          id: `${type}-${Date.now()}-${i}`,
          type,
          label: libElement.label,
          icon: libElement.icon,
          props: {},
        };
      })
      .filter((el): el is ComponentElement => el !== null);

    setElements(templateElements);
    setConfig({ ...config, template: templateId });
  };

  const generateCode = () => {
    const compId = config.id.startsWith("custom-")
      ? "YOUR_COMPONENT_ID"
      : config.id;
    return `import { ArcenpayEmbed } from '@arcenpay/react';

const App = () => {
  // Generate this token server-side — see the "Backend" snippet below
  const token = "...your_access_token...";

  return (
    <ArcenpayEmbed
      accessToken={token}
      id="${compId}"
        />
  );
};`;
  };

  const generateBackendCode = () => {
    const compId = config.id.startsWith("custom-")
      ? "YOUR_COMPONENT_ID"
      : config.id;
    return `// Node.js / server-side — generate a short-lived access token
const res = await apiFetch('http://localhost:3000/api/v1/access-tokens', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer api_your_api_key',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    company: { id: 'your_company_id' },
    expires_in: 3600,
  }),
});
const { data } = await res.json();
// data.token  → pass this as the accessToken prop
// data.expires_at → ISO timestamp

// Component ID (already known): "${compId}"`;
  };

  const generateInstallCode = () => {
    return `npm install @arcenpay/react wagmi viem`;
  };

  const handleSave = () => {
    const updatedComponent: ComponentConfig = {
      ...config,
      elements,
      updatedAt: new Date(),
    };
    onSave(updatedComponent);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(generateCode());
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const downloadCode = () => {
    const code = generateCode();
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${config.name.replace(/\s+/g, "")}.tsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updateStyling = (patch: Partial<ComponentConfig["styling"]>) =>
    setConfig((c) => ({ ...c, styling: { ...c.styling, ...patch } }));
  const updateCardStyle = (
    patch: Partial<ComponentConfig["styling"]["cardStyle"]>,
  ) =>
    setConfig((c) => ({
      ...c,
      styling: {
        ...c.styling,
        cardStyle: { ...c.styling.cardStyle, ...patch },
      },
    }));
  const updateTypography = (
    patch: Partial<ComponentConfig["styling"]["typography"]>,
  ) =>
    setConfig((c) => ({
      ...c,
      styling: {
        ...c.styling,
        typography: { ...c.styling.typography, ...patch },
      },
    }));

  // Right panel tab state — "elements" (custom only) | "design" | "properties" (when editable element selected)
  const [rightTab, setRightTab] = useState<
    "elements" | "design" | "properties"
  >(isCustom ? "elements" : "design");

  // Types whose props are user-editable in the Properties panel
  const EDITABLE_TYPES = ["text", "button"] as const;

  // Update a single element's props by id
  const updateElementProps = (id: string, patch: Record<string, unknown>) =>
    setElements((els) =>
      els.map((el) =>
        el.id === id ? { ...el, props: { ...el.props, ...patch } } : el,
      ),
    );

  // ── Right sidebar panel ─────────────────────────────────────
  const rightPanel = (
    <div className="w-full md:w-[280px] border-t md:border-t-0 md:border-l border-border overflow-y-auto bg-card shrink-0 flex flex-col max-h-[50vh] md:max-h-none">
      {/* Tab switcher — Elements | Design | Properties */}
      <div className="border-b border-border shrink-0">
        <div className="flex">
          {isCustom && (
            <button
              onClick={() => setRightTab("elements")}
              className={cn(
                "flex-1 py-3 text-xs font-medium border-b-2 -mb-px transition-colors",
                rightTab === "elements"
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              Elements
            </button>
          )}
          <button
            onClick={() => setRightTab("design")}
            className={cn(
              "flex-1 py-3 text-xs font-medium border-b-2 -mb-px transition-colors",
              rightTab === "design"
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Design
          </button>
          {selectedElement && (
              <button
                onClick={() => setRightTab("properties")}
                className={cn(
                  "flex-1 py-3 text-xs font-medium border-b-2 -mb-px transition-colors",
                  rightTab === "properties"
                    ? "border-accent text-accent"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                Properties
              </button>
            )}
        </div>
      </div>

      {/* ── ELEMENTS TAB — custom only ── */}
      {isCustom && rightTab === "elements" && (
        <div className="flex-1 overflow-y-auto">
          {/* Current elements list */}
          {elements.length > 0 && (
            <div className="px-4 py-3 border-b border-border">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Added Elements
              </p>
              <div className="space-y-1">
                {elements.map((el, index) => {
                  const Icon = resolveElementIcon(el);
                  return (
                    <div
                      key={el.id}
                      draggable
                      onDragStart={(e) => {
                        setDragIndex(index);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null && dragIndex !== index) {
                          moveElementToPosition(dragIndex, index);
                        }
                        setDragIndex(null);
                      }}
                      onDragEnd={() => setDragIndex(null)}
                      onClick={() => {
                        setSelectedElement(el.id);
                        setRightTab("properties");
                      }}
                      className={cn(
                        "flex items-center gap-2 py-1.5 group rounded px-1 -mx-1 cursor-pointer transition-colors duration-150",
                        selectedElement === el.id
                          ? "bg-accent/10 ring-1 ring-accent/30"
                          : "hover:bg-secondary/50",
                        dragIndex === index && "opacity-40",
                      )}
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0 cursor-grab" />
                      <div className="w-5 h-5 rounded bg-accent/10 flex items-center justify-center shrink-0">
                        <Icon className="w-3 h-3 text-accent" />
                      </div>
                      <span
                        className={cn(
                          "text-xs flex-1 truncate",
                          selectedElement === el.id
                            ? "text-accent font-semibold"
                            : "text-foreground",
                        )}
                      >
                        {el.label}
                      </span>
                      <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElement(index, "up");
                          }}
                          disabled={index === 0}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-25"
                        >
                          <ChevronUp className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            moveElement(index, "down");
                          }}
                          disabled={index === elements.length - 1}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-25"
                        >
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeElement(el.id);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary"
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Element library */}
          {ELEMENT_LIBRARY.map((cat) => (
            <div key={cat.category} className="px-4 pt-3 pb-1">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {cat.category}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {cat.elements.map((el) => {
                  const Icon: LucideIcon =
                    typeof el.icon === "function" ? el.icon : Layers;
                  const isAdded = elements.some(
                    (e) => toEditorElementType(e.type) === el.type,
                  );
                  return (
                    <div
                      key={el.type}
                      draggable={!isAdded}
                      onDragStart={() => handleDragStart(el)}
                      onClick={() => {
                        if (!isAdded) addElement(el);
                      }}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 p-2 rounded-lg border transition-all duration-150 select-none",
                        isAdded
                          ? "border-foreground/30 bg-foreground/5 cursor-default opacity-60"
                          : "border-border bg-background hover:border-foreground/20 hover:bg-secondary/50 cursor-pointer",
                      )}
                    >
                      {/* Mini wireframe preview */}
                      <div className="w-full h-12 rounded-md bg-secondary/50 overflow-hidden flex items-center justify-center">
                        <ElementMiniPreview type={el.type} />
                      </div>
                      <span className="text-[9px] font-semibold text-foreground text-center leading-tight">
                        {el.label}
                      </span>
                      {isAdded && (
                        <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-foreground flex items-center justify-center">
                          <Check className="w-2 h-2 text-background" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="h-3" />
        </div>
      )}

      {/* ── PROPERTIES TAB — text / button element config ── */}
      {rightTab === "properties" &&
        (() => {
          const selEl = elements.find((e) => e.id === selectedElement);
          if (!selEl) return null;
          const p = selEl.props ?? {};
          if (selEl.type === "text") {
            return (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Text Block
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Heading
                  </label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Your heading here"
                    value={String(p.heading ?? "")}
                    onChange={(e) =>
                      updateElementProps(selEl.id, { heading: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Body text
                  </label>
                  <Textarea
                    className="text-xs resize-none"
                    rows={4}
                    placeholder="Add your text content here..."
                    value={String(p.body ?? "")}
                    onChange={(e) =>
                      updateElementProps(selEl.id, { body: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Alignment
                  </label>
                  <div className="flex gap-1">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button
                        key={a}
                        onClick={() =>
                          updateElementProps(selEl.id, { alignment: a })
                        }
                        className={cn(
                          "flex-1 h-7 rounded text-xs font-medium capitalize transition-all",
                          (p.alignment ?? "left") === a
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          }
          if (selEl.type === "button") {
            return (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Button
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="Click Me"
                    value={String(p.label ?? "")}
                    onChange={(e) =>
                      updateElementProps(selEl.id, { label: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">
                    Link / URL
                  </label>
                  <Input
                    className="h-8 text-xs font-mono"
                    placeholder="https://..."
                    value={String(p.href ?? "")}
                    onChange={(e) =>
                      updateElementProps(selEl.id, { href: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Style</label>
                  <div className="flex gap-1">
                    {(["filled", "outlined", "ghost"] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() =>
                          updateElementProps(selEl.id, { variant: v })
                        }
                        className={cn(
                          "flex-1 h-7 rounded text-xs font-medium capitalize transition-all",
                          (p.variant ?? "filled") === v
                            ? "bg-accent text-accent-foreground"
                            : "bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground">
                    Full width
                  </label>
                  <button
                    onClick={() =>
                      updateElementProps(selEl.id, { fullWidth: !p.fullWidth })
                    }
                    className={cn(
                      "w-9 h-5 rounded-full relative transition-colors",
                      p.fullWidth ? "bg-accent" : "bg-secondary",
                    )}
                  >
                    <div
                      className={cn(
                        "absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-all",
                        p.fullWidth ? "right-0.5" : "left-0.5",
                      )}
                    />
                  </button>
                </div>
              </div>
            );
          }
          if (selEl.type === "invoices") {
            return (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center">
                    <ReceiptText className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {selEl.label}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No configurable properties. Invoices are auto-populated from
                  your billing data.
                </p>
              </div>
            );
          }
          if (selEl.type === "next-bill-due") {
            return (
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center">
                    <Clock className="w-3.5 h-3.5 text-accent" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {selEl.label}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No configurable properties. Next bill amount and date are
                  auto-populated from your billing data.
                </p>
              </div>
            );
          }
          return (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded bg-accent/10 flex items-center justify-center">
                  <Layers className="w-3.5 h-3.5 text-accent" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {selEl.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Type: {selEl.type}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This element is auto-populated from your catalog data.
              </p>
            </div>
          );
        })()}

      {/* ── DESIGN TAB ── */}
      {rightTab === "design" && (
        <div className="flex-1 overflow-y-auto transition-colors duration-300">
          <div className="px-4 py-3 text-xs text-muted-foreground border-b border-border">
            Define styling for all elements within this component.
          </div>

          {/* Component name */}
          <div className="px-4 py-3 border-b border-border">
            <Label
              htmlFor="comp-name"
              className="text-[10px] font-medium text-muted-foreground mb-1.5 block uppercase tracking-wider"
            >
              Name
            </Label>
            <Input
              id="comp-name"
              value={config.name}
              onChange={(e) => setConfig({ ...config, name: e.target.value })}
              className="h-8 text-xs"
            />
          </div>

          {/* General */}
          <DesignSection
            title="General"
            open={openSections.general}
            onToggle={() => toggleSection("general")}
          >
            <DesignRow label="Columns">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((num) => (
                  <button
                    key={num}
                    onClick={() => updateStyling({ columns: num })}
                    className={cn(
                      "w-7 h-7 rounded text-xs font-medium transition-all",
                      config.styling.columns === num
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </DesignRow>
            <DesignRow label="Sections">
              <div className="flex gap-1">
                {(["merged", "separate"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => updateStyling({ sections: mode })}
                    className={cn(
                      "px-2 h-7 rounded text-xs font-medium capitalize transition-all",
                      config.styling.sections === mode
                        ? "bg-accent text-accent-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </DesignRow>
            <DesignRow label="Primary Color">
              <div
                className="w-5 h-5 rounded-full border border-border shrink-0 transition-colors duration-300"
                style={{ backgroundColor: config.styling.primaryColor }}
              />
              <Input
                type="color"
                value={config.styling.primaryColor}
                onChange={(e) =>
                  updateStyling({ primaryColor: e.target.value })
                }
                className="w-8 h-7 p-0.5 cursor-pointer rounded"
              />
              <Input
                value={config.styling.primaryColor}
                onChange={(e) =>
                  updateStyling({ primaryColor: e.target.value })
                }
                className="h-7 w-20 font-mono text-xs"
              />
            </DesignRow>
            <DesignRow label="Secondary Color">
              <div
                className="w-5 h-5 rounded-full border border-border shrink-0 transition-colors duration-300"
                style={{ backgroundColor: config.styling.secondaryColor }}
              />
              <Input
                type="color"
                value={config.styling.secondaryColor}
                onChange={(e) =>
                  updateStyling({ secondaryColor: e.target.value })
                }
                className="w-8 h-7 p-0.5 cursor-pointer rounded"
              />
              <Input
                value={config.styling.secondaryColor}
                onChange={(e) =>
                  updateStyling({ secondaryColor: e.target.value })
                }
                className="h-7 w-20 font-mono text-xs"
              />
            </DesignRow>
          </DesignSection>

          {/* Card Styling */}
          <DesignSection
            title="Card Styling"
            open={openSections.cardStyling}
            onToggle={() => toggleSection("cardStyling")}
          >
            <DesignRow label="Background">
              <div
                className="w-5 h-5 rounded-full border border-border shrink-0 transition-colors duration-300"
                style={{
                  backgroundColor:
                    config.styling.cardStyle.backgroundColor || "#ffffff",
                }}
              />
              <Input
                type="color"
                value={config.styling.cardStyle.backgroundColor || "#ffffff"}
                onChange={(e) =>
                  updateCardStyle({ backgroundColor: e.target.value })
                }
                className="w-8 h-7 p-0.5 cursor-pointer rounded"
              />
              <Input
                value={config.styling.cardStyle.backgroundColor || ""}
                onChange={(e) =>
                  updateCardStyle({ backgroundColor: e.target.value })
                }
                className="h-7 w-20 font-mono text-xs"
                placeholder="auto"
              />
            </DesignRow>
            <DesignRow label="Border Radius">
              <Input
                value={config.styling.cardStyle.borderRadius}
                onChange={(e) =>
                  updateCardStyle({ borderRadius: e.target.value })
                }
                className="h-7 w-[108px] text-xs"
                placeholder="8px"
              />
            </DesignRow>
            <DesignRow label="Card Shadow">
              <button
                onClick={() =>
                  updateCardStyle({
                    cardShadow: !config.styling.cardStyle.cardShadow,
                  })
                }
                className={cn(
                  "w-9 h-5 rounded-full relative transition-colors",
                  config.styling.cardStyle.cardShadow
                    ? "bg-foreground"
                    : "bg-secondary border border-border",
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full transition-all",
                    config.styling.cardStyle.cardShadow
                      ? "bg-background"
                      : "bg-muted-foreground/40",
                    config.styling.cardStyle.cardShadow
                      ? "right-0.5"
                      : "left-0.5",
                  )}
                />
              </button>
            </DesignRow>
            <DesignRow label="Card Padding">
              <Input
                value={config.styling.cardStyle.cardPadding}
                onChange={(e) =>
                  updateCardStyle({ cardPadding: e.target.value })
                }
                className="h-7 w-[108px] text-xs"
                placeholder="20px"
              />
            </DesignRow>
          </DesignSection>

          {/* Typography */}
          <DesignSection
            title="Typography"
            open={openSections.typography}
            onToggle={() => toggleSection("typography")}
          >
            <DesignRow label="Font">
              <Select
                value={config.styling.typography.fontFamily}
                onValueChange={(v) => updateTypography({ fontFamily: v })}
              >
                <SelectTrigger className="h-7 w-[108px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  {["Inter", "DM Sans", "system-ui", "Geist"].map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DesignRow>
            <DesignRow label="Size">
              <Select
                value={config.styling.typography.fontSize || "14px"}
                onValueChange={(v) => updateTypography({ fontSize: v })}
              >
                <SelectTrigger className="h-7 w-[108px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  {["12px", "13px", "14px", "15px", "16px"].map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DesignRow>
          </DesignSection>

          {/* Mini sample card */}
          <div className="px-4 py-3 border-t border-border">
            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Live Preview
            </p>
            <div
              className="rounded-lg border border-border p-3 space-y-2 transition-colors duration-300"
              style={{
                backgroundColor:
                  config.styling.cardStyle.backgroundColor || "#ffffff",
                borderRadius: config.styling.cardStyle.borderRadius || "8px",
                boxShadow: config.styling.cardStyle.cardShadow
                  ? "0 4px 12px rgba(0,0,0,0.08)"
                  : "none",
                fontFamily:
                  config.styling.typography.fontFamily || "system-ui, sans-serif",
              }}
            >
              <div
                className="h-2.5 w-16 rounded transition-colors duration-300"
                style={{ backgroundColor: config.styling.primaryColor }}
              />
              <p
                className="text-xs font-semibold transition-colors duration-300"
                style={{
                  color: config.styling.primaryColor,
                  fontSize: config.styling.typography.fontSize || "14px",
                }}
              >
                Sample text
              </p>
              <p
                className="text-[10px] text-muted-foreground leading-relaxed"
                style={{
                  fontSize: `${parseFloat(config.styling.typography.fontSize || "14") - 2}px`,
                }}
              >
                This preview shows how your design choices affect the look of
                component content.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const editorContent = (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border flex justify-between items-center px-3 md:px-6 bg-background/80 backdrop-blur-sm shrink-0 gap-2 md:gap-4">
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-1.5 md:gap-2 text-muted-foreground hover:text-foreground px-2 md:px-3"
          >
            ← <span className="hidden sm:inline">Back</span>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">
              {config.name}
            </h2>
            <p className="text-xs text-muted-foreground hidden sm:block">
              {config.type === "sdk" ? "SDK Component" : "Custom Component"}
            </p>
          </div>
        </div>

        {/* Center: viewport size switcher */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5 shrink-0">
          {(["desktop", "tablet", "mobile"] as const).map((size) => (
            <button
              key={size}
              onClick={() => setViewportSize(size)}
              title={size}
              className={cn(
                "px-2.5 py-1.5 rounded-md transition-all",
                viewportSize === size
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {size === "desktop" ? (
                <svg
                  className="w-4 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 18"
                >
                  <rect x="1" y="1" width="22" height="14" rx="2" />
                  <path d="M8 17h8M12 15v2" />
                </svg>
              ) : size === "tablet" ? (
                <svg
                  className="w-3 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 16 20"
                >
                  <rect x="1" y="1" width="14" height="18" rx="2" />
                  <circle cx="8" cy="17" r="0.5" fill="currentColor" />
                </svg>
              ) : (
                <svg
                  className="w-2.5 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 12 20"
                >
                  <rect x="1" y="1" width="10" height="18" rx="2" />
                  <circle cx="6" cy="17" r="0.5" fill="currentColor" />
                </svg>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          {/* Component | Code switcher */}
          <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5">
            {(["component", "code"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={cn(
                  "flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 capitalize",
                  activeView === v
                    ? "bg-foreground/10 text-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "component" ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <Code2 className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {v === "component" ? "Component" : "Code"}
                </span>
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-border hidden md:block" />
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCode}
            className="gap-2 text-xs hidden sm:flex"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
          <Button size="sm" onClick={handleSave} className="gap-2 text-xs">
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* ── COMPONENT view ── */}
        {activeView === "component" && (
          <div className="flex flex-col md:flex-row flex-1 min-w-0 overflow-y-auto">
            {/* ── CENTER: Viewport ── */}
            <div className="flex-1 flex flex-col min-w-0 bg-secondary/5 shrink-0 md:shrink min-h-[50vh] md:min-h-0">
              {/* View-state tab bar — shown for ALL component types */}
              <div className="flex items-center border-b border-border px-2 md:px-4 shrink-0 bg-background/80 backdrop-blur-sm overflow-x-auto">
                {componentViews.map((vs) => (
                  <button
                    key={vs.id}
                    onClick={() => {
                      setActiveViewState(vs.id);
                      setEmbedMountKey((k) => k + 1);
                    }}
                    className={cn(
                      "px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                      activeViewState === vs.id
                        ? "border-foreground text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {vs.label}
                  </button>
                ))}
                {/* Company data selector */}
                <div className="ml-auto flex items-center gap-1.5 md:gap-2 py-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
                    Preview as:
                  </span>
                  <Select
                    value={previewCompanyId ?? "__sample__"}
                    onValueChange={(val) => {
                      if (val === "__sample__") {
                        resetToSampleData();
                      } else {
                        loadCompanyPreviewData(val);
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs w-[120px] md:w-[160px]">
                      <SelectValue placeholder="Sample Preview Data" />
                    </SelectTrigger>
                    <SelectContent className="z-[10000]">
                      <SelectItem value="__sample__">
                        Sample Preview Data
                      </SelectItem>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {previewCompanyId && (
                    <span className="text-[10px] text-foreground font-medium whitespace-nowrap">
                      Live data
                    </span>
                  )}
                </div>
              </div>

              {/* Viewport content */}
              <div className="flex-1 overflow-y-auto p-2 md:p-6">
                <div
                  style={{
                    maxWidth: "100%",
                    minWidth: 0,
                    margin: "0 auto",
                    boxSizing: "border-box",
                    overflow: "hidden",
                    transition: "max-width 0.2s ease",
                  }}
                >
                  <div className="mb-3 md:mb-4 flex items-start md:items-center justify-between gap-2 md:gap-3 rounded-lg border border-border/60 bg-secondary/20 px-2 md:px-3 py-2 text-[10px] md:text-xs text-muted-foreground">
                    <span className="hidden sm:inline">
                      {previewCompanyId
                        ? "Live company preview. Billing, plans, entitlements, and invoices come from the selected company context."
                        : "Sample preview mode. This editor uses seeded sample values until you choose a real company."}
                    </span>
                    <span className="sm:hidden">
                      {previewCompanyId ? "Live data" : "Sample data"}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 font-medium",
                        previewCompanyId
                          ? "bg-secondary text-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {previewCompanyId ? "Live data" : "Sample data"}
                    </span>
                  </div>
                  {isCustom ? (
                    /* ── Custom component: ArcenEmbed for ALL views ── */
                    elements.length === 0 && activeViewState === "portal" ? (
                      /* Empty portal canvas */
                      <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        className={cn(
                          "flex flex-col items-center justify-center min-h-[520px] rounded-2xl border-2 border-dashed transition-all duration-200 select-none",
                          draggedElement
                            ? "border-foreground/40 bg-foreground/5"
                            : "border-border bg-background/40",
                        )}
                      >
                        <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center mb-4 border border-border">
                          <LayoutTemplate className="w-6 h-6 text-muted-foreground/40" />
                        </div>
                        <p className="text-sm font-bold text-foreground tracking-tight mb-1">
                          {draggedElement
                            ? `Drop "${draggedElement.label}" here`
                            : "Empty canvas"}
                        </p>
                        <p className="text-xs text-muted-foreground mb-5 text-center max-w-[200px] leading-relaxed">
                          {draggedElement
                            ? "Release to add this element"
                            : "Add elements from the panel on the right"}
                        </p>
                        {!draggedElement && (
                          <button
                            onClick={() => setRightTab("elements")}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-xs font-semibold text-foreground hover:bg-secondary transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Elements
                          </button>
                        )}
                      </div>
                    ) : activeViewState === "disabled" ? (
                      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                          <MinusCircle className="w-5 h-5" />
                        </div>
                        <p className="text-sm font-semibold">
                          Component disabled
                        </p>
                        <p className="text-xs text-center max-w-[220px] leading-relaxed">
                          This is how the component appears when disabled for a
                          user segment.
                        </p>
                      </div>
                    ) : (
                      /* Live ArcenEmbed preview — portal, checkout, wallet, unsubscribe */
                      <div
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        className="min-h-full"
                      >
                        <ArcenEmbed
                          key={embedMountKey}
                          componentId=""
                          id=""
                          className=""
                          mockData={canvasMockData}
                          initialView={tabToEmbedView(activeViewState)}
                          accessToken="preview"
                          onPlanChange={() => {}}
                          mode="inline"
                          style={{
                            width:
                              viewportSize === "desktop"
                                ? "100%"
                                : viewportSize === "tablet"
                                  ? "768px"
                                  : "360px",
                            maxWidth: "100%",
                            minWidth: 0,
                            margin: "0 auto",
                            overflow: "hidden",
                          }}
                          onViewChange={(v: string) => {
                            const reverseMap: Record<string, string> = {
                              portal: "portal",
                              checkout: "checkout",
                              payment: "payment-method",
                              unsubscribe: "unsubscribe",
                              success: "portal",
                            };
                            setActiveViewState(reverseMap[v] ?? "portal");
                          }}
                        />
                        {/* Drop zone overlay for adding elements via drag */}
                        {draggedElement && (
                          <div className="mt-4 h-12 rounded-xl border-2 border-dashed border-foreground/30 bg-foreground/5 flex items-center justify-center gap-2">
                            <Plus className="w-4 h-4 text-foreground/50" />
                            <span className="text-sm text-foreground/50 font-medium">
                              Drop &quot;{draggedElement.label}&quot; here to
                              add
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  ) : /* ── Non-custom SDK components: real ArcenEmbed preview ── */
                  activeViewState === "disabled" ? (
                    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-muted-foreground">
                      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center">
                        <MinusCircle className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-semibold">
                        Component disabled
                      </p>
                      <p className="text-xs text-center max-w-[220px] leading-relaxed">
                        This is how the component appears when disabled for a
                        user segment.
                      </p>
                    </div>
                  ) : (
                    <div className="min-h-full">
                      <ArcenEmbed
                        key={embedMountKey}
                        componentId=""
                        id=""
                        className=""
                        mockData={canvasMockData}
                        initialView={tabToEmbedView(activeViewState)}
                        accessToken="preview"
                        onPlanChange={() => {}}
                        mode="inline"
                        style={{
                          width:
                            viewportSize === "desktop"
                              ? "100%"
                              : viewportSize === "tablet"
                                ? "768px"
                                : "360px",
                          maxWidth: "100%",
                          minWidth: 0,
                          margin: "0 auto",
                          overflow: "hidden",
                        }}
                        onViewChange={(v: string) => {
                          const reverseMap: Record<string, string> = {
                            portal: "portal",
                            checkout: "checkout",
                            payment: "payment-method",
                            unsubscribe: "unsubscribe",
                            success: "portal",
                          };
                          setActiveViewState(reverseMap[v] ?? activeViewState);
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── RIGHT: Elements / Design panel ── */}
            {rightPanel}
          </div>
        )}

        {/* ── CODE view ──────────────────────────────────── */}
        {activeView === "code" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Embed this component
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Drop{" "}
                  <code className="font-mono bg-secondary rounded px-1">
                    {"<ArcenpayEmbed />"}
                  </code>{" "}
                  into your dApp with a server-generated access token.
                </p>
              </div>

              {/* Component ID */}
              {!config.id.startsWith("custom-") && (
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Component ID
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-sm font-mono text-foreground bg-secondary rounded-lg px-3 py-2 truncate">
                      {config.id}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigator.clipboard.writeText(config.id)}
                      className="h-9 w-9 p-0 shrink-0"
                      title="Copy component ID"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Pass this as the{" "}
                    <code className="font-mono bg-secondary rounded px-1">
                      id
                    </code>{" "}
                    prop to{" "}
                    <code className="font-mono bg-secondary rounded px-1">
                      {"<ArcenpayEmbed />"}
                    </code>
                  </p>
                </div>
              )}
              {config.id.startsWith("custom-") && (
                <div className="bg-secondary border border-border rounded-xl p-4">
                  <p className="text-xs font-semibold text-warning mb-1">
                    Save your component first
                  </p>
                  <p className="text-xs text-warning">
                    Click &quot;Save&quot; to persist this component and get a
                    permanent component ID you can embed.
                  </p>
                </div>
              )}

              {/* 1. Install */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">
                    1 — Install
                  </span>
                </div>
                <pre className="p-4 overflow-x-auto text-xs font-mono text-foreground/80">
                  <code>{generateInstallCode()}</code>
                </pre>
              </div>

              {/* 2. Frontend embed snippet */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">
                    2 — Frontend (React / Next.js)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={copyCode}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
                <pre className="p-4 overflow-x-auto text-xs font-mono text-foreground/80">
                  <code>{generateCode()}</code>
                </pre>
              </div>

              {/* 3. Backend token generation */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">
                    3 — Backend: Generate Access Token (Node.js)
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generateBackendCode());
                    }}
                    className="h-7 gap-1.5 text-xs"
                  >
                    <Copy className="w-3 h-3" />
                    Copy
                  </Button>
                </div>
                <pre className="p-4 overflow-x-auto text-xs font-mono text-foreground/80">
                  <code>{generateBackendCode()}</code>
                </pre>
              </div>

              {/* Notes */}
              <div className="bg-secondary/30 rounded-xl p-4 space-y-1.5">
                <p className="text-xs font-semibold text-foreground">
                  How it works
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>
                    Your backend calls{" "}
                    <code className="font-mono bg-secondary rounded px-1">
                      POST /api/v1/access-tokens
                    </code>{" "}
                    with your API key to get a short-lived token (1 hr).
                  </li>
                  <li>
                    Pass that token + the component ID to{" "}
                    <code className="font-mono bg-secondary rounded px-1">
                      {"<ArcenpayEmbed />"}
                    </code>
                    .
                  </li>
                  <li>
                    The component fetches your configured elements (plan
                    manager, usage bars, features) and renders them — no extra
                    code needed.
                  </li>
                  <li>
                    Manage your API keys in{" "}
                    <span className="text-foreground font-medium">
                      Settings → API Keys
                    </span>
                    .
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (!mounted) return null;
  return createPortal(editorContent, document.body);
}
