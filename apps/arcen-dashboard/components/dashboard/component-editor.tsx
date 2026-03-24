"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
} from "lucide-react";
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
}

export interface RealFlag {
  featureKey: string;
  name: string;
  featureType?: string;
  defaultValue?: boolean;
}

export interface RealData {
  plans: RealPlan[];
  flags: RealFlag[];
}

export interface ComponentElement {
  id: string;
  type: string;
  label: string;
  icon: React.ElementType;
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
      { type: "pricing-table", label: "Pricing Table", icon: Layers },
    ],
  },
  {
    category: "Billing",
    elements: [
      { type: "next-bill-due", label: "Next Bill Due", icon: Clock },
      { type: "invoices", label: "Invoices", icon: ReceiptText },
      { type: "billing-history", label: "Billing History", icon: FileText },
      { type: "checkout-modal", label: "Checkout", icon: Zap },
    ],
  },
  {
    category: "Basics",
    elements: [
      {
        type: "subscription-status",
        label: "Subscription Status",
        icon: Shield,
      },
      { type: "usage-dashboard", label: "Usage Dashboard", icon: BarChart3 },
    ],
  },
];

const ALL_ELEMENTS = ELEMENT_LIBRARY.flatMap((cat) => cat.elements);

/** Resolve the icon for an element — falls back to the library definition if
 *  el.icon is missing/invalid (e.g. after JSON round-trip from the API). */
function resolveElementIcon(el: ComponentElement): React.ElementType {
  if (typeof el.icon === "function") return el.icon;
  const lib = ALL_ELEMENTS.find((e) => e.type === el.type);
  return lib?.icon ?? Layers;
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
  primaryColor,
  secondaryColor,
  fontFamily,
}: {
  type: string;
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
}) {
  const accent = primaryColor || "#000000";
  const secBg = secondaryColor || "#f5f5f5";
  const font = fontFamily || "inherit";
  switch (type) {
    case "pricing-table": {
      const demoPlans = [
        { name: "Starter", price: 9, billingInterval: "monthly" },
        { name: "Pro", price: 29, billingInterval: "monthly" },
        { name: "Enterprise", price: 99, billingInterval: "monthly" },
      ];
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
      return (
        <div className="space-y-3" style={{ fontFamily: font }}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xl font-bold text-foreground tracking-tight">
                Pro
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                For growing teams
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-sm font-bold text-foreground">
                  $29.00
                </span>
                <span className="text-[10px] text-muted-foreground">
                  /mo · USDC
                </span>
              </div>
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
          >
            Change Plan
          </button>
        </div>
      );
    }

    case "included-features": {
      const feats = [
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

    case "metered-features":
      return (
        <div className="space-y-4">
          {[
            { name: "API Calls", used: 7_500, limit: 10_000, unit: "" },
            { name: "Storage", used: 3.2, limit: 10, unit: " GB" },
          ].map((m, i) => (
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
                <p className="text-[10px] font-bold text-foreground">{s.value}</p>
                <p className="text-[7px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="flex items-end gap-0.5 h-8">
            {[40, 55, 35, 70, 60, 80, 65, 90, 75, 85, 70, 95].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, backgroundColor: accent, opacity: 0.25 + (h / 95) * 0.5 }} />
            ))}
          </div>
        </div>
      );

    case "next-bill-due":
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
                $29.00
              </span>
              <span className="text-xs text-muted-foreground">USDC</span>
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

    case "checkout-modal": {
      const planName = "Pro Plan";
      const planPrice = "$29";
      const billingLabel = "/mo";
      const token = "USDC";
      const steps = ["Wallet", "Approve", "Subscribe"];
      const activeStep = 1;
      return (
        <div className="space-y-2" style={{ fontFamily: font }}>
          <div className="rounded-lg border border-border bg-card p-2.5 space-y-2.5 shadow-sm">
            {/* Modal header */}
            <div className="flex items-center justify-between pb-1.5 border-b border-border">
              <span className="text-[10px] font-semibold text-foreground">Subscribe to {planName}</span>
              <div className="w-3.5 h-3.5 rounded-full bg-secondary flex items-center justify-center text-[8px] text-muted-foreground cursor-pointer">✕</div>
            </div>
            {/* Step bar */}
            <div className="flex items-center gap-0.5">
              {steps.map((step, i) => (
                <React.Fragment key={i}>
                  <div
                    className="flex items-center justify-center w-4 h-4 rounded-full text-[7px] font-bold shrink-0"
                    style={{
                      backgroundColor: i <= activeStep ? accent : "hsl(var(--secondary))",
                      color: i <= activeStep ? "#fff" : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {i < activeStep ? "✓" : i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div className="h-0.5 flex-1" style={{ backgroundColor: i < activeStep ? accent : "hsl(var(--border))" }} />
                  )}
                </React.Fragment>
              ))}
            </div>
            {/* Plan + wallet */}
            <div className="flex items-center justify-between p-1.5 rounded-md border border-border" style={{ backgroundColor: secBg + "40" }}>
              <div>
                <p className="text-[8px] text-muted-foreground">Subscribing to</p>
                <p className="text-[9px] font-semibold text-foreground">{planName}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-foreground">{planPrice}<span className="text-[7px] font-normal text-muted-foreground">{billingLabel}</span></p>
                <p className="text-[7px] text-muted-foreground">{token}</p>
              </div>
            </div>
            {/* Wallet connected */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-secondary/30 border border-border">
              <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}20` }}>
                <Check className="w-2.5 h-2.5" style={{ color: accent }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] text-muted-foreground">Wallet</p>
                <p className="text-[8px] font-mono text-foreground truncate">0x4a2f…8c3d · Base</p>
              </div>
            </div>
            {/* CTA */}
            <div className="h-6 rounded-md text-[8px] font-semibold flex items-center justify-center text-white" style={{ backgroundColor: accent }}>
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
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: accent }} />
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
    default:
      return <div className="w-8 h-8 rounded-lg bg-foreground/10" />;
  }
}

// ============================================================
// SDK Viewport Preview — full-size view-state renderer
// ============================================================

interface SdkViewportPreviewProps {
  componentId: string;
  viewState: string;
  styling: ComponentConfig["styling"];
  viewportSize?: "desktop" | "tablet" | "mobile";
  realData?: RealData;
  onViewChange?: (vs: string) => void;
}

function SdkViewportPreview({
  componentId,
  viewState,
  styling,
  viewportSize = "desktop",
  realData,
  onViewChange,
}: SdkViewportPreviewProps) {
  // Simulation state
  const [simCancelled, setSimCancelled] = useState(false);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(1);

  // Reset when switching view states
  useEffect(() => {
    setSimCancelled(false);
  }, [viewState, componentId]);
  // Always use clean demo data — never show raw blockchain data in preview
  const plans: RealPlan[] = [
    {
      id: "s",
      name: "Starter",
      price: 9,
      billingInterval: "monthly",
      acceptedToken: "USDC",
    },
    {
      id: "p",
      name: "Pro",
      price: 29,
      billingInterval: "monthly",
      acceptedToken: "USDC",
    },
    {
      id: "e",
      name: "Enterprise",
      price: 99,
      billingInterval: "monthly",
      acceptedToken: "USDC",
    },
  ];
  const demoFlags = [
    { featureKey: "api", name: "API Access", defaultValue: true },
    { featureKey: "hooks", name: "Webhooks", defaultValue: true },
    { featureKey: "domain", name: "Custom Domain", defaultValue: false },
    { featureKey: "sso", name: "SSO", defaultValue: false },
  ];
  const activePlan = plans[selectedPlanIdx] ?? plans[0];
  const token = "USDC";

  const primary = styling.primaryColor || "#000000";
  const radius = styling.cardStyle.borderRadius || "8px";
  const shadow = styling.cardStyle.cardShadow
    ? "0 4px 16px 0 rgb(0 0 0 / 0.08)"
    : "none";
  const padding = styling.cardStyle.cardPadding || "24px";
  const cardBg = styling.cardStyle.backgroundColor || undefined;
  const font = styling.typography.fontFamily || "inherit";
  const fs = parseInt(styling.typography.fontSize || "14") || 14;
  const twoCol = viewportSize !== "mobile";

  const card: React.CSSProperties = {
    background: cardBg,
    borderRadius: radius,
    boxShadow: shadow,
    padding,
    border: "1px solid hsl(var(--border))",
    fontFamily: font,
  };
  const btnPrimary: React.CSSProperties = {
    backgroundColor: primary,
    color: "#fff",
    borderRadius: `calc(${radius} - 2px)`,
    fontSize: 13,
    fontWeight: 600,
    padding: "10px 20px",
    cursor: "pointer",
    border: "none",
    display: "inline-block",
    fontFamily: font,
  };
  const btnSecondary: React.CSSProperties = {
    backgroundColor: "hsl(var(--secondary))",
    color: "hsl(var(--foreground))",
    borderRadius: `calc(${radius} - 2px)`,
    fontSize: 13,
    fontWeight: 500,
    padding: "10px 20px",
    cursor: "pointer",
    border: "1px solid hsl(var(--border))",
    display: "inline-block",
    fontFamily: font,
  };

  const key = `${componentId}:${viewState}`;

  switch (key) {
    // ── customer-portal: Portal ───────────────────────────────
    case "customer-portal:portal": {
      const docIcon = (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
      );
      const includedFeatures = [
        { name: "Scan", limit: "3 Scans", resets: "4/24" },
        { name: "API Access", limit: "Unlimited", resets: null },
      ];
      const cardNoPad: React.CSSProperties = { ...card, padding: 0, overflow: "hidden" };
      return (
        <div style={{ fontFamily: font, fontSize: fs }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: twoCol ? "1.4fr 1fr" : "1fr",
            gap: 16,
            alignItems: "start",
          }}>
            {/* ── Left: Plan + Features ─────────────────────── */}
            <div style={cardNoPad}>
              {/* Subscription canceled banner */}
              {simCancelled && (
                <div style={{
                  background: "hsl(var(--secondary))",
                  padding: "12px 20px",
                  textAlign: "center",
                  borderBottom: "1px solid hsl(var(--border))",
                }}>
                  <p style={{ fontSize: fs, fontWeight: 600, color: "hsl(var(--foreground))", margin: 0 }}>Subscription canceled</p>
                  <p style={{ fontSize: fs - 2, color: "hsl(var(--muted-foreground))", margin: "2px 0 0" }}>Access to plan will end on 4/24/2026</p>
                </div>
              )}

              {/* Plan info */}
              <div style={{ padding }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                  <div>
                    <p style={{ fontSize: fs + 18, fontWeight: 800, lineHeight: 1.05, color: "hsl(var(--foreground))", margin: 0 }}>{activePlan.name}</p>
                    <p style={{ fontSize: fs - 2, color: "hsl(var(--muted-foreground))", marginTop: 4 }}>
                      {activePlan.description || "Included with your subscription"}
                    </p>
                  </div>
                  <p style={{ fontSize: fs + 4, fontWeight: 700, color: "hsl(var(--foreground))", margin: 0, whiteSpace: "nowrap" }}>
                    ${activePlan.price.toFixed(2)}
                  </p>
                </div>
                <button
                  style={{ ...btnPrimary, width: "100%", textAlign: "center", display: "block" }}
                  onClick={() => onViewChange?.("checkout")}
                >
                  Change plan
                </button>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: "hsl(var(--border))" }} />

              {/* Included features */}
              <div style={{ padding }}>
                <p style={{ fontSize: fs, fontWeight: 700, color: "hsl(var(--foreground))", margin: "0 0 12px" }}>Included features</p>
                {includedFeatures.map((feat, i) => (
                  <div key={i} style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 0",
                    borderBottom: i < includedFeatures.length - 1 ? "1px solid hsl(var(--border))" : undefined,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32,
                        borderRadius: "50%",
                        background: "hsl(var(--secondary))",
                        border: "1px solid hsl(var(--border))",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0,
                      }}>{docIcon}</div>
                      <span style={{ fontSize: fs, fontWeight: 500, color: "hsl(var(--foreground))" }}>{feat.name}</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontSize: fs - 1, fontWeight: 600, color: "hsl(var(--foreground))", margin: 0 }}>{feat.limit}</p>
                      {feat.resets && <p style={{ fontSize: fs - 3, color: "hsl(var(--muted-foreground))", margin: "1px 0 0" }}>Resets {feat.resets}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {/* Metered feature card */}
              <div style={{ padding: `0 ${padding} ${padding}` }}>
                <div style={{
                  border: "1px solid hsl(var(--border))",
                  borderRadius: radius,
                  padding: 16,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <div style={{
                      width: 36, height: 36,
                      borderRadius: "50%",
                      background: "hsl(var(--secondary))",
                      border: "1px solid hsl(var(--border))",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: fs + 6, fontWeight: 700, color: "hsl(var(--foreground))", margin: 0 }}>Scan</p>
                  </div>
                  <p style={{ fontSize: fs - 1, color: "hsl(var(--muted-foreground))", margin: "0 0 8px" }}>Scan the receipt for information</p>
                  <p style={{ fontSize: fs, fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 2px" }}>0 Scans used</p>
                  <p style={{ fontSize: fs - 2, color: "hsl(var(--muted-foreground))", margin: 0 }}>Limit of 3 · Resets 4/24</p>
                </div>
              </div>

              {/* Cancel subscription */}
              <div style={{ padding: `0 ${padding} ${padding}` }}>
                <button
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: fs - 1, color: "hsl(var(--muted-foreground))", padding: 0, fontFamily: font }}
                  onClick={() => onViewChange?.("unsubscribe")}
                >
                  Cancel subscription
                </button>
              </div>
            </div>

            {/* ── Right column ─────────────────────────────── */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Payment Method */}
              <div style={card}>
                <p style={{ fontSize: fs + 2, fontWeight: 700, color: "hsl(var(--foreground))", margin: "0 0 12px" }}>
                  Payment Method
                </p>
                <div style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px",
                  background: "hsl(var(--secondary))",
                  borderRadius: `calc(${radius} - 2px)`,
                  border: "1px solid hsl(var(--border))",
                }}>
                  <div style={{
                    width: 28, height: 28,
                    borderRadius: 6,
                    background: "#000",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <span style={{ color: "#fff", fontSize: 12, lineHeight: 1 }}>⬡</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: fs - 1, fontFamily: "monospace", fontWeight: 600, color: "hsl(var(--foreground))", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>0x4a2f…8c3d</p>
                    <p style={{ fontSize: fs - 3, color: "hsl(var(--muted-foreground))", margin: "2px 0 0" }}>Base · USDC</p>
                  </div>
                  <button
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: fs - 1, fontWeight: 600, color: primary, fontFamily: font, flexShrink: 0 }}
                    onClick={() => onViewChange?.("payment-method")}
                  >
                    Edit
                  </button>
                </div>
              </div>

              {/* ArcenPay branding */}
              <div style={{ textAlign: "center", paddingTop: 4 }}>
                <p style={{ fontSize: 11, color: "hsl(var(--muted-foreground))", margin: 0 }}>
                  Secured by <strong style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>ArcenPay</strong> · On-chain stablecoin billing
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Checkout — plan selection + subscription summary (SchematicHQ style) ──
    case "customer-portal:checkout":
    case "checkout:checkout":
    case "checkout-modal:checkout": {
      const chosenPlan = plans[selectedPlanIdx] ?? plans[0];
      return (
        <div style={{ fontFamily: font }} className="max-w-3xl mx-auto">
          {/* Step indicator */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-6 h-6 rounded-full border border-border flex items-center justify-center">
              <span className="text-xs text-muted-foreground">1</span>
            </div>
            <span className="text-sm font-medium text-foreground">Plan</span>
            <div className="ml-auto">
              <button
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() => onViewChange?.("portal")}
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
          </div>

          <div
            className="grid gap-6"
            style={{ gridTemplateColumns: twoCol ? "1fr 340px" : "1fr" }}
          >
            {/* Left — Plan selection */}
            <div>
              <p className="text-lg font-semibold text-foreground mb-1">
                Select plan
              </p>
              <p className="text-sm text-muted-foreground mb-5">
                Choose your base plan
              </p>
              <div className="space-y-4">
                {plans.map((plan, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPlanIdx(i)}
                    style={{
                      display: "block",
                      width: "100%",
                      border:
                        selectedPlanIdx === i
                          ? `2px solid ${primary}`
                          : "1px solid hsl(var(--border))",
                      borderRadius: radius,
                      background: cardBg,
                      padding: padding,
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: font,
                      transition: "all 0.15s",
                    }}
                  >
                    <p className="text-lg font-bold text-foreground mb-0.5">
                      {plan.name}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {plan.price === 9
                        ? "Perfect for Starter Business"
                        : plan.price === 29
                          ? "For growing teams"
                          : "For large organizations"}
                    </p>
                    <p className="text-2xl font-bold text-foreground mb-3">
                      ${plan.price.toFixed(2)}
                      <span className="text-sm font-normal text-muted-foreground">
                        /month
                      </span>
                    </p>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-5 h-5 rounded bg-secondary flex items-center justify-center">
                        <Layers className="w-3 h-3 text-muted-foreground" />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {plan.price === 9
                          ? "3 Scans per month"
                          : plan.price === 29
                            ? "50 Scans per month"
                            : "Unlimited"}
                      </span>
                    </div>
                    <div
                      style={{
                        ...btnPrimary,
                        width: "100%",
                        textAlign: "center",
                        display: "block",
                      }}
                    >
                      Choose plan
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right — Subscription summary */}
            <div style={card}>
              <p className="text-base font-semibold text-foreground mb-4">
                Subscription
              </p>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="text-xs text-muted-foreground">Plan</p>
                  <p className="text-sm font-semibold text-foreground">
                    {chosenPlan.name}
                  </p>
                </div>
                <p className="text-sm font-semibold text-foreground">
                  ${chosenPlan.price.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground">
                    /mo
                  </span>
                </p>
              </div>
              <div className="h-px bg-border my-4" />
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">Monthly total:</p>
                <p className="text-sm font-semibold text-foreground">
                  ${chosenPlan.price.toFixed(2)}/mo
                </p>
              </div>
              <button
                style={{
                  ...btnSecondary,
                  width: "100%",
                  textAlign: "center",
                  opacity: 0.6,
                  cursor: "default",
                }}
              >
                Subscribe and close
              </button>
              <p className="text-[10px] text-muted-foreground mt-3 text-center leading-relaxed">
                You will be billed ${chosenPlan.price.toFixed(2)} USDC for this subscription every month unless you unsubscribe.
              </p>
              <div className="mt-4 pt-3 border-t border-border text-center">
                <p className="text-[9px] text-muted-foreground">Secured by <span className="font-semibold text-foreground">ArcenPay</span> · On-chain</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Payment Method — modal dialog overlay (SchematicHQ style) ──
    case "customer-portal:payment-method": {
      return (
        <div
          style={{ fontFamily: font }}
          className="relative max-w-3xl mx-auto min-h-[400px]"
        >
          {/* Blurred background */}
          <div className="absolute inset-0 opacity-30 blur-sm pointer-events-none">
            <div
              className="grid gap-5"
              style={{ gridTemplateColumns: "1fr 1fr" }}
            >
              <div style={card}>
                <div className="h-3 w-24 bg-foreground/10 rounded mb-2" />
                <div className="h-2 w-32 bg-foreground/5 rounded mb-4" />
                <div className="h-8 bg-foreground/5 rounded" />
              </div>
              <div style={card}>
                <div className="h-3 w-20 bg-foreground/10 rounded mb-2" />
                <div className="h-2 w-28 bg-foreground/5 rounded" />
              </div>
            </div>
          </div>
          {/* Modal dialog */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              style={{
                ...card,
                maxWidth: 460,
                width: "100%",
                boxShadow: "0 8px 32px rgb(0 0 0/0.12)",
              }}
            >
              <div className="flex items-center justify-between mb-5">
                <p className="text-base font-semibold text-foreground">
                  Payment Wallet
                </p>
                <button
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                  }}
                  onClick={() => onViewChange?.("portal")}
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              <p className="text-sm font-semibold text-foreground mb-3">
                Connected Wallet
              </p>
              <div
                className="flex items-center gap-3 p-3 rounded-lg mb-4"
                style={{
                  background: "hsl(var(--secondary))",
                  borderRadius: radius,
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: "hsl(var(--secondary))",
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  <span style={{ fontSize: 14 }}>⬡</span>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground font-mono">
                    0x4a2f…8c3d
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Base · USDC Wallet
                  </p>
                </div>
                <span
                  className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: `hsl(var(--secondary))`,
                    color: `hsl(var(--muted-foreground))`,
                    border: "1px solid hsl(var(--border))",
                  }}
                >
                  Default
                </span>
              </div>
              <button
                className="text-sm font-medium flex items-center gap-1"
                style={{
                  color: "hsl(var(--muted-foreground))",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: font,
                }}
              >
                Connect different wallet <ChevronDown className="w-4 h-4" />
              </button>
              {/* ArcenPay branding */}
              <div className="mt-5 pt-4 border-t border-border text-center">
                <p className="text-[10px] text-muted-foreground">
                  Secured by <span className="font-semibold text-foreground">ArcenPay</span> · On-chain stablecoin billing
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Unsubscribe — cancel dialog (SchematicHQ style) ──────
    case "customer-portal:unsubscribe": {
      if (simCancelled) {
        return (
          <div style={{ fontFamily: font }} className="max-w-sm mx-auto">
            <div style={{ ...card, textAlign: "center" }}>
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "hsl(var(--secondary))" }}
              >
                <Check className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                Subscription cancelled
              </p>
              <p className="text-xs text-muted-foreground mb-5">
                You have access until the end of this billing period.
              </p>
              <button
                style={{ ...btnSecondary, minWidth: 140 }}
                onClick={() => {
                  setSimCancelled(false);
                  onViewChange?.("portal");
                }}
              >
                Back to Portal
              </button>
            </div>
          </div>
        );
      }
      return (
        <div
          style={{ fontFamily: font }}
          className="relative max-w-3xl mx-auto min-h-[400px]"
        >
          {/* Blurred background */}
          <div className="absolute inset-0 opacity-30 blur-sm pointer-events-none">
            <div
              className="grid gap-5"
              style={{ gridTemplateColumns: "1fr 1fr" }}
            >
              <div style={card}>
                <div className="h-3 w-24 bg-foreground/10 rounded mb-2" />
                <div className="h-2 w-32 bg-foreground/5 rounded mb-4" />
                <div className="h-8 bg-foreground/5 rounded" />
              </div>
              <div style={card}>
                <div className="h-3 w-20 bg-foreground/10 rounded mb-2" />
                <div className="h-2 w-28 bg-foreground/5 rounded" />
              </div>
            </div>
          </div>
          {/* Cancel dialog */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              style={{
                ...card,
                maxWidth: 520,
                width: "100%",
                boxShadow: "0 8px 32px rgb(0 0 0/0.12)",
                padding: 0,
              }}
            >
              <div className="flex">
                {/* Left — cancel info */}
                <div style={{ padding: padding, flex: 1 }}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-lg font-bold text-foreground">
                      Cancel subscription
                    </p>
                    <button
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                      onClick={() => onViewChange?.("portal")}
                    >
                      <X className="w-5 h-5 text-muted-foreground" />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                    You will retain access to your plan until the end of the
                    billing period, on 3/29/2026
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Not ready to cancel?
                  </p>
                  <button
                    style={{
                      ...btnSecondary,
                      fontSize: 12,
                      padding: "8px 16px",
                    }}
                    onClick={() => onViewChange?.("portal")}
                  >
                    Manage plan
                  </button>
                </div>
                {/* Right — plan summary */}
                <div
                  style={{
                    padding: padding,
                    borderLeft: "1px solid hsl(var(--border))",
                    minWidth: 220,
                  }}
                >
                  <div
                    style={{
                      borderRadius: radius,
                      border: "1px solid hsl(var(--border))",
                      padding: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <p className="text-xs text-muted-foreground mb-0.5">Plan</p>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-foreground">
                        {activePlan.name}
                      </p>
                      <p className="text-sm font-semibold text-foreground">
                        ${activePlan.price.toFixed(2)}
                        <span className="text-xs font-normal text-muted-foreground">
                          /mo
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs text-muted-foreground">
                      Monthly total:
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      ${activePlan.price.toFixed(2)}/mo
                    </p>
                  </div>
                  <button
                    style={{
                      ...btnPrimary,
                      width: "100%",
                      textAlign: "center",
                      backgroundColor: primary,
                    }}
                    onClick={() => {
                      setSimCancelled(true);
                      onViewChange?.("portal");
                    }}
                  >
                    Cancel subscription
                  </button>
                  {/* ArcenPay branding */}
                  <p className="text-[10px] text-muted-foreground text-center mt-3">
                    Secured by <span className="font-semibold text-foreground">ArcenPay</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Disabled — Portal not found (SchematicHQ style) ──────
    case "customer-portal:disabled":
    case "pricing-table:disabled": {
      return (
        <div style={{ fontFamily: font }} className="max-w-3xl mx-auto">
          <div
            className="grid gap-5"
            style={{ gridTemplateColumns: "1fr 1fr" }}
          >
            <div style={card}>
              <p className="text-2xl font-bold text-foreground mb-2">
                Portal not found
              </p>
              <p className="text-sm text-muted-foreground">
                Please try again later.
              </p>
            </div>
          </div>
          <div className="mt-12 text-center">
            <p className="text-xs text-muted-foreground">
              Powered by{" "}
              <span className="font-semibold text-foreground">ArcenPay</span>
            </p>
          </div>
        </div>
      );
    }

    // ── checkout-modal aliases ─────────────────────────────────
    case "checkout-modal:plans":
    case "checkout:plans":
    case "pricing-table:plans": {
      return (
        <div
          style={{ fontFamily: font }}
          className="max-w-2xl mx-auto space-y-4"
        >
          <div className="text-center mb-2">
            <p className="text-base font-semibold text-foreground">
              Choose your plan
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Billed in {token} · cancel anytime
            </p>
          </div>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)`,
            }}
          >
            {plans.map((plan, i) => {
              const isPopular = i === 1;
              return (
                <div
                  key={i}
                  style={{
                    border: isPopular
                      ? `2px solid ${primary}`
                      : "1px solid hsl(var(--border))",
                    borderRadius: radius,
                    background: isPopular ? `${primary}06` : cardBg,
                    boxShadow: isPopular ? `0 0 0 4px ${primary}14` : shadow,
                    padding,
                  }}
                >
                  {isPopular && (
                    <div
                      className="text-[10px] font-semibold px-2 py-0.5 mb-3 w-fit rounded-full"
                      style={{ backgroundColor: primary, color: "#fff" }}
                    >
                      Most Popular
                    </div>
                  )}
                  <p className="text-sm font-semibold text-foreground mb-1">
                    {plan.name}
                  </p>
                  <p className="text-2xl font-bold text-foreground mb-0.5">
                    ${plan.price}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{plan.billingInterval === "yearly" ? "yr" : "mo"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    {plan.acceptedToken ?? "USDC"}
                  </p>
                  <div className="space-y-2 mb-5">
                    {[
                      {
                        featureKey: "f1",
                        name: "API Access",
                        defaultValue: true,
                      },
                      {
                        featureKey: "f2",
                        name: "Webhooks",
                        defaultValue: i >= 1,
                      },
                      { featureKey: "f3", name: "SSO", defaultValue: i >= 2 },
                    ].map((f, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <div
                          className="w-4 h-4 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: f.defaultValue
                              ? `${primary}20`
                              : "hsl(var(--secondary))",
                          }}
                        >
                          {f.defaultValue && (
                            <Check
                              className="w-2.5 h-2.5"
                              style={{ color: primary }}
                            />
                          )}
                        </div>
                        <span className="text-xs text-foreground">
                          {f.name}
                        </span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedPlanIdx(i);
                      onViewChange?.("checkout");
                    }}
                    style={{
                      width: "100%",
                      borderRadius: `calc(${radius} - 2px)`,
                      padding: "10px 0",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                      border: isPopular
                        ? "none"
                        : "1px solid hsl(var(--border))",
                      backgroundColor: isPopular
                        ? primary
                        : "hsl(var(--secondary))",
                      color: isPopular ? "#fff" : "hsl(var(--foreground))",
                      textAlign: "center",
                      fontFamily: font,
                    }}
                  >
                    {isPopular ? "Get Started" : "Select"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    case "checkout-modal:success":
    case "checkout:success": {
      const donePlan = plans[selectedPlanIdx] ?? plans[0];
      return (
        <div style={{ fontFamily: font }} className="max-w-sm mx-auto">
          <div style={{ ...card, textAlign: "center" }}>
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: primary }}
            >
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="text-base font-semibold text-foreground mb-1">
              You&apos;re subscribed!
            </p>
            <p className="text-xs text-muted-foreground mb-1">
              Now on the <strong>{donePlan.name}</strong> plan.
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              Transaction confirmed on Base.
            </p>
            <button
              style={{ ...btnPrimary, minWidth: 160 }}
              onClick={() => onViewChange?.("portal")}
            >
              Go to Portal
            </button>
          </div>
        </div>
      );
    }

    // ── plan-manager: Active ───────────────────────────────────
    case "plan-manager:active": {
      const planFeatures = [
        { featureKey: "f1", name: "API Access", defaultValue: true },
        { featureKey: "f2", name: "Webhooks", defaultValue: true },
        { featureKey: "f3", name: "Priority Support", defaultValue: true },
      ];
      return (
        <div style={{ fontFamily: font }} className="max-w-md mx-auto">
          <div style={card}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {activePlan.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  ${activePlan.price}/
                  {activePlan.billingInterval === "yearly" ? "yr" : "mo"} ·{" "}
                  {token}
                </p>
              </div>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ backgroundColor: `${primary}15`, color: primary }}
              >
                Active
              </span>
            </div>
            <div className="space-y-2 mb-5">
              {planFeatures.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Check
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: primary }}
                  />
                  <span className="text-xs text-foreground">{f.name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                style={{
                  ...btnSecondary,
                  flex: 1,
                  textAlign: "center",
                  fontSize: 12,
                  padding: "8px 0",
                }}
                onClick={() => onViewChange?.("unsubscribe")}
              >
                Downgrade
              </button>
              <button
                style={{
                  ...btnPrimary,
                  flex: 1,
                  textAlign: "center",
                  fontSize: 12,
                  padding: "8px 0",
                }}
                onClick={() => onViewChange?.("checkout")}
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground">
            No preview for this state.
          </p>
        </div>
      );
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
  const [elements, setElements] = useState<ComponentElement[]>(
    component.elements,
  );
  const [draggedElement, setDraggedElement] = useState<ComponentElement | null>(
    null,
  );
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<
    "desktop" | "tablet" | "mobile"
  >("desktop");

  const isCustom = config.type === "custom";

  // Both custom AND SDK components use the same view states.
  // Custom components use customer-portal views (Portal = their assembled elements, rest = standard flows).
  // SDK components use their own view map.
  const componentViews = isCustom
    ? COMPONENT_VIEWS["customer-portal"]
    : (COMPONENT_VIEWS[component.id] ??
      COMPONENT_VIEWS[component.template] ??
      COMPONENT_VIEWS["customer-portal"]);

  const [activeViewState, setActiveViewState] = useState<string>(
    componentViews[0]?.id ?? "portal",
  );

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
    const imports = new Set<string>();
    const hasCheckoutModal = elements.some(
      (el) => el.type === "checkout-modal",
    );

    elements.forEach((el) => {
      const componentName = el.type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
      imports.add(componentName);
    });

    const reactImports = hasCheckoutModal
      ? `import { useState } from 'react';\n`
      : "";

    return `${reactImports}import { ${Array.from(imports).join(", ")}, MEAPProvider } from '@meap/react';

export function ${config.name.replace(/\s+/g, "")}() {${
      hasCheckoutModal
        ? `
  const [checkoutOpen, setCheckoutOpen] = useState(false);`
        : ""
    }
  return (
    <MEAPProvider>
      <div className="container mx-auto p-6 space-y-6">
${elements
  .map((el) => {
    const componentName = el.type
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
    if (el.type === "checkout-modal") {
      return `        <button onClick={() => setCheckoutOpen(true)}>Upgrade Plan</button>
        <${componentName} isOpen={checkoutOpen} onClose={() => setCheckoutOpen(false)} />`;
    }
    return `        <${componentName} />`;
  })
  .join("\n")}
      </div>
    </MEAPProvider>
  );
}`;
  };

  const generateInstallCode = () => {
    return `# Install via npm / pnpm
npm install @meap/react @meap/core wagmi viem

# Then wrap your app with MEAPProvider (see Installation guide)
# and drop the component into your page.`;
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

  // Right panel tab state — "elements" (custom only) vs "design"
  const [rightTab, setRightTab] = useState<"elements" | "design">(
    isCustom ? "elements" : "design",
  );

  // ── Right sidebar panel ─────────────────────────────────────
  const rightPanel = (
    <div className="w-[280px] border-l border-border overflow-y-auto bg-card shrink-0 flex flex-col">
      {/* Tab switcher — Elements | Design */}
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
                      className="flex items-center gap-2 py-1.5 group"
                    >
                      <GripVertical className="w-3 h-3 text-muted-foreground/30 shrink-0 cursor-grab" />
                      <div className="w-5 h-5 rounded bg-accent/10 flex items-center justify-center shrink-0">
                        <Icon className="w-3 h-3 text-accent" />
                      </div>
                      <span className="text-xs text-foreground flex-1 truncate">
                        {el.label}
                      </span>
                      <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => moveElement(index, "up")}
                          disabled={index === 0}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-25"
                        >
                          <ChevronUp className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => moveElement(index, "down")}
                          disabled={index === elements.length - 1}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-25"
                        >
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        </button>
                        <button
                          onClick={() => removeElement(el.id)}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-destructive/10"
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
                  const Icon: React.ElementType = typeof el.icon === "function" ? el.icon : Layers;
                  const isAdded = elements.some((e) => e.type === el.type);
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

      {/* ── DESIGN TAB ── */}
      {rightTab === "design" && (
        <div className="flex-1 overflow-y-auto">
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
                    config.styling.cardStyle.cardShadow ? "bg-background" : "bg-muted-foreground/40",
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
                <SelectContent>
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
                <SelectContent>
                  {["12px", "13px", "14px", "15px", "16px"].map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </DesignRow>
          </DesignSection>
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
      <div className="h-14 border-b border-border flex items-center px-6 bg-background/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            ← Back
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {config.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {config.type === "sdk" ? "SDK Component" : "Custom Component"}
            </p>
          </div>
        </div>

        {/* Center: viewport size switcher */}
        <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
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

        <div className="flex items-center gap-3 flex-1 justify-end">
          {/* Component | Code switcher */}
          <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5">
            {(["component", "code"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 capitalize",
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
                {v === "component" ? "Component" : "Code"}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-border" />
          <Button
            variant="outline"
            size="sm"
            onClick={downloadCode}
            className="gap-2 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="gap-2 text-xs"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* ── COMPONENT view ── */}
        {activeView === "component" && (
          <div className="flex flex-1 min-w-0">
            {/* ── CENTER: Viewport ── */}
            <div className="flex-1 flex flex-col min-w-0 bg-secondary/5">
              {/* View-state tab bar — shown for ALL component types */}
              <div className="flex items-center border-b border-border px-4 shrink-0 bg-background/80 backdrop-blur-sm">
                {componentViews.map((vs) => (
                  <button
                    key={vs.id}
                    onClick={() => setActiveViewState(vs.id)}
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
              </div>

              {/* Viewport content */}
              <div className="flex-1 overflow-y-auto p-6">
                <div
                  style={{
                    maxWidth:
                      viewportSize === "desktop"
                        ? "100%"
                        : viewportSize === "tablet"
                          ? "768px"
                          : "390px",
                    margin: "0 auto",
                    transition: "max-width 0.2s ease",
                  }}
                >
                  {isCustom && activeViewState === "portal" ? (
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      className="min-h-full"
                    >
                      {elements.length === 0 ? (
                        /* ── Empty canvas ── */
                        <div
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
                      ) : (
                        /* ── Two-column portal layout ── */
                        <div
                          className={cn(
                            "transition-all duration-150",
                            draggedElement &&
                              "ring-2 ring-inset ring-foreground/20 rounded-2xl",
                          )}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              elements.some((e) =>
                                [
                                  "next-bill-due",
                                  "invoices",
                                  "billing-history",
                                  "checkout-modal",
                                ].includes(e.type),
                              ) &&
                              elements.some((e) =>
                                [
                                  "plan-manager",
                                  "metered-features",
                                  "included-features",
                                  "pricing-table",
                                  "subscription-status",
                                  "usage-dashboard",
                                ].includes(e.type),
                              )
                                ? "1.5fr 1fr"
                                : "1fr",
                            gap: "16px",
                            fontFamily:
                              config.styling.typography.fontFamily || "inherit",
                          }}
                        >
                          {/* Left column — plan/usage/features */}
                          {(() => {
                            const leftTypes = [
                              "plan-manager",
                              "metered-features",
                              "included-features",
                              "pricing-table",
                              "subscription-status",
                              "usage-dashboard",
                            ];
                            const leftEls = elements.filter((e) =>
                              leftTypes.includes(e.type),
                            );
                            const rightTypes = [
                              "next-bill-due",
                              "invoices",
                              "billing-history",
                              "checkout-modal",
                            ];
                            const allRight = elements.every((e) =>
                              rightTypes.includes(e.type),
                            );
                            if (leftEls.length === 0 && !allRight) return null;
                            const displayEls =
                              leftEls.length > 0 ? leftEls : elements;
                            return (
                              <div className="space-y-3">
                                {displayEls.map((element) => {
                                  const elIdx = elements.findIndex(
                                    (e) => e.id === element.id,
                                  );
                                  const isSelected =
                                    selectedElement === element.id;
                                  return (
                                    <div
                                      key={element.id}
                                      className={cn(
                                        "relative group/el rounded-xl border overflow-hidden cursor-pointer transition-all duration-150",
                                        isSelected
                                          ? "ring-2 ring-foreground border-foreground"
                                          : "border-border hover:border-foreground/30 hover:shadow-sm",
                                      )}
                                      style={{
                                        borderRadius:
                                          config.styling.cardStyle
                                            .borderRadius || "10px",
                                        backgroundColor:
                                          config.styling.cardStyle
                                            .backgroundColor || undefined,
                                        boxShadow: isSelected
                                          ? undefined
                                          : config.styling.cardStyle.cardShadow
                                            ? "0 1px 4px rgba(0,0,0,0.06)"
                                            : undefined,
                                        fontFamily:
                                          config.styling.typography
                                            .fontFamily || undefined,
                                        padding:
                                          config.styling.cardStyle
                                            .cardPadding || "24px",
                                      }}
                                      onClick={() =>
                                        setSelectedElement(
                                          isSelected ? null : element.id,
                                        )
                                      }
                                    >
                                      {isSelected && (
                                        <div className="absolute top-0 left-0 right-0 h-7 bg-foreground flex items-center justify-between px-3 z-10">
                                          <span className="text-[10px] font-bold text-background tracking-wide uppercase">
                                            {element.label}
                                          </span>
                                          <div className="flex items-center gap-0.5">
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20 transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (elIdx > 0) {
                                                  const ne = [...elements];
                                                  [ne[elIdx], ne[elIdx - 1]] = [
                                                    ne[elIdx - 1],
                                                    ne[elIdx],
                                                  ];
                                                  setElements(ne);
                                                }
                                              }}
                                            >
                                              <ChevronUp className="w-3 h-3 text-background" />
                                            </button>
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20 transition-colors"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (
                                                  elIdx <
                                                  elements.length - 1
                                                ) {
                                                  const ne = [...elements];
                                                  [ne[elIdx], ne[elIdx + 1]] = [
                                                    ne[elIdx + 1],
                                                    ne[elIdx],
                                                  ];
                                                  setElements(ne);
                                                }
                                              }}
                                            >
                                              <ChevronDown className="w-3 h-3 text-background" />
                                            </button>
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20 transition-colors ml-1"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setElements(
                                                  elements.filter(
                                                    (el) =>
                                                      el.id !== element.id,
                                                  ),
                                                );
                                                setSelectedElement(null);
                                              }}
                                            >
                                              <Trash2 className="w-3 h-3 text-background" />
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      <div
                                        style={{
                                          paddingTop: isSelected
                                            ? "28px"
                                            : undefined,
                                        }}
                                      >
                                        <ElementPreview
                                          type={element.type}
                                          primaryColor={config.styling.primaryColor}
                                          secondaryColor={config.styling.secondaryColor}
                                          fontFamily={config.styling.typography.fontFamily}
                                        />
                                      </div>
                                      {!isSelected && (
                                        <div className="absolute top-2 left-2 opacity-0 group-hover/el:opacity-100 transition-opacity">
                                          <span className="text-[9px] font-bold uppercase tracking-wider bg-foreground text-background px-2 py-0.5 rounded-full">
                                            {element.label}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}

                          {/* Right column — billing/payments */}
                          {(() => {
                            const rightTypes = [
                              "next-bill-due",
                              "invoices",
                              "billing-history",
                              "checkout-modal",
                            ];
                            const rightEls = elements.filter((e) =>
                              rightTypes.includes(e.type),
                            );
                            if (rightEls.length === 0) return null;
                            return (
                              <div className="space-y-3">
                                {rightEls.map((element) => {
                                  const elIdx = elements.findIndex(
                                    (e) => e.id === element.id,
                                  );
                                  const isSelected =
                                    selectedElement === element.id;
                                  return (
                                    <div
                                      key={element.id}
                                      className={cn(
                                        "relative group/el rounded-xl border overflow-hidden cursor-pointer transition-all duration-150",
                                        isSelected
                                          ? "ring-2 ring-foreground border-foreground"
                                          : "border-border hover:border-foreground/30 hover:shadow-sm",
                                      )}
                                      style={{
                                        borderRadius:
                                          config.styling.cardStyle
                                            .borderRadius || "10px",
                                        backgroundColor:
                                          config.styling.cardStyle
                                            .backgroundColor || undefined,
                                        boxShadow: isSelected
                                          ? undefined
                                          : config.styling.cardStyle.cardShadow
                                            ? "0 1px 4px rgba(0,0,0,0.06)"
                                            : undefined,
                                        fontFamily:
                                          config.styling.typography
                                            .fontFamily || undefined,
                                        padding:
                                          config.styling.cardStyle
                                            .cardPadding || "24px",
                                      }}
                                      onClick={() =>
                                        setSelectedElement(
                                          isSelected ? null : element.id,
                                        )
                                      }
                                    >
                                      {isSelected && (
                                        <div className="absolute top-0 left-0 right-0 h-7 bg-foreground flex items-center justify-between px-3 z-10">
                                          <span className="text-[10px] font-bold text-background tracking-wide uppercase">
                                            {element.label}
                                          </span>
                                          <div className="flex items-center gap-0.5">
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (elIdx > 0) {
                                                  const ne = [...elements];
                                                  [ne[elIdx], ne[elIdx - 1]] = [
                                                    ne[elIdx - 1],
                                                    ne[elIdx],
                                                  ];
                                                  setElements(ne);
                                                }
                                              }}
                                            >
                                              <ChevronUp className="w-3 h-3 text-background" />
                                            </button>
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (
                                                  elIdx <
                                                  elements.length - 1
                                                ) {
                                                  const ne = [...elements];
                                                  [ne[elIdx], ne[elIdx + 1]] = [
                                                    ne[elIdx + 1],
                                                    ne[elIdx],
                                                  ];
                                                  setElements(ne);
                                                }
                                              }}
                                            >
                                              <ChevronDown className="w-3 h-3 text-background" />
                                            </button>
                                            <button
                                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-background/20 ml-1"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setElements(
                                                  elements.filter(
                                                    (el) =>
                                                      el.id !== element.id,
                                                  ),
                                                );
                                                setSelectedElement(null);
                                              }}
                                            >
                                              <Trash2 className="w-3 h-3 text-background" />
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                      <div
                                        style={{
                                          paddingTop: isSelected
                                            ? "28px"
                                            : undefined,
                                        }}
                                      >
                                        <ElementPreview
                                          type={element.type}
                                          primaryColor={config.styling.primaryColor}
                                          secondaryColor={config.styling.secondaryColor}
                                          fontFamily={config.styling.typography.fontFamily}
                                        />
                                      </div>
                                      {!isSelected && (
                                        <div className="absolute top-2 left-2 opacity-0 group-hover/el:opacity-100 transition-opacity">
                                          <span className="text-[9px] font-bold uppercase tracking-wider bg-foreground text-background px-2 py-0.5 rounded-full">
                                            {element.label}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {/* Drop zone when dragging */}
                      {draggedElement && elements.length > 0 && (
                        <div className="mt-4 h-12 rounded-xl border-2 border-dashed border-foreground/30 bg-foreground/5 flex items-center justify-center gap-2">
                          <Plus className="w-4 h-4 text-foreground/50" />
                          <span className="text-sm text-foreground/50 font-medium">
                            Drop &quot;{draggedElement.label}&quot; here
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* ── Checkout / Payment Method / Unsubscribe / Disabled views ── */
                    <div className="max-w-3xl mx-auto">
                      <SdkViewportPreview
                        componentId={
                          isCustom ? "customer-portal" : component.id
                        }
                        viewState={activeViewState}
                        styling={config.styling}
                        viewportSize={viewportSize}
                        onViewChange={(vs) => setActiveViewState(vs)}
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
                  Installation Code
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Embed this component in your app
                </p>
              </div>

              {/* React / Next.js */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">
                    React / Next.js
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

              {/* Setup Instructions */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">
                    Setup Instructions
                  </span>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2">
                      1. Install Dependencies
                    </p>
                    <pre className="bg-secondary/30 p-3 rounded-lg text-xs font-mono border border-border">
                      npm install @meap/react @meap/core wagmi viem
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2">
                      2. Configure Provider
                    </p>
                    <pre className="bg-secondary/30 p-3 rounded-lg text-xs font-mono border border-border overflow-x-auto">
                      <code>{`import { MEAPProvider } from '@meap/react';
import { WagmiProvider, createConfig } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';

const config = createConfig({
  chains: [base, baseSepolia],
  // ... your wagmi config
});

function App() {
  return (
    <WagmiProvider config={config}>
      <MEAPProvider>
        {/* Your component here */}
      </MEAPProvider>
    </WagmiProvider>
  );
}`}</code>
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-1">
                      3. Use Component
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Copy the React code above and paste it into your
                      application. The component will automatically connect to
                      your Web3 subscription infrastructure.
                    </p>
                  </div>
                </div>
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
