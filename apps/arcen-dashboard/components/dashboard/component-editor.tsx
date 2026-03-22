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
  CreditCard,
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
    category: "Plans & Entitlements",
    elements: [
      { type: "pricing-table", label: "Pricing Table", icon: Layers },
      { type: "plan-manager", label: "Plan Manager", icon: ArrowUpDown },
      {
        type: "included-features",
        label: "Included Features",
        icon: ShieldCheck,
      },
      {
        type: "subscription-status",
        label: "Subscription Status",
        icon: Shield,
      },
    ],
  },
  {
    category: "Usage & Metering",
    elements: [
      { type: "metered-features", label: "Metered Features", icon: Gauge },
      { type: "usage-dashboard", label: "Usage Dashboard", icon: BarChart3 },
    ],
  },
  {
    category: "Billing & Payments",
    elements: [
      { type: "next-bill-due", label: "Next Bill Due", icon: Clock },
      { type: "payment-method", label: "Payment Method", icon: CreditCard },
      { type: "invoices", label: "Invoices", icon: ReceiptText },
      { type: "billing-history", label: "Billing History", icon: FileText },
      { type: "checkout-modal", label: "Checkout Modal", icon: Zap },
    ],
  },
];

const ALL_ELEMENTS = ELEMENT_LIBRARY.flatMap((cat) => cat.elements);

// ============================================================
// SDK View-state map
// ============================================================

const COMPONENT_VIEWS: Record<string, { id: string; label: string }[]> = {
  "customer-portal": [
    { id: "portal", label: "Portal" },
    { id: "checkout", label: "Checkout" },
    { id: "payment-method", label: "Payment Method" },
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

function ElementPreview({ type, realData }: { type: string; realData?: RealData }) {
  switch (type) {
    case "pricing-table": {
      const defaultPlans = [
        { name: "Starter", price: 9, billingInterval: "monthly" },
        { name: "Pro", price: 29, billingInterval: "monthly" },
        { name: "Enterprise", price: 99, billingInterval: "monthly" },
      ];
      const plans = realData?.plans?.length
        ? realData.plans.slice(0, 3)
        : defaultPlans;
      return (
        <div className="space-y-2">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)` }}>
            {plans.map((plan, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3 space-y-2",
                  i === 1
                    ? "border-accent bg-accent/5"
                    : "border-border bg-secondary/20",
                )}
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
                      <div className="w-2 h-2 rounded-full bg-accent/30 flex items-center justify-center">
                        <Check className="w-1.5 h-1.5 text-accent" />
                      </div>
                      <div className="h-1 flex-1 rounded bg-foreground/8" />
                    </div>
                  ))}
                </div>
                <div
                  className={cn(
                    "h-5 rounded text-[8px] font-medium flex items-center justify-center",
                    i === 1
                      ? "bg-accent text-accent-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
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
      const activePlan = realData?.plans?.[1] ?? realData?.plans?.[0];
      const planName = activePlan?.name ?? "Pro Plan";
      const planPrice = activePlan ? `$${activePlan.price}/${activePlan.billingInterval === "yearly" ? "yr" : "mo"}` : "$29/month";
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-foreground">
                {planName}
              </p>
              <p className="text-[9px] text-muted-foreground">{planPrice}</p>
            </div>
            <Badge
              variant="secondary"
              className="text-[8px] h-4 bg-accent/10 text-accent border-accent/20"
            >
              Active
            </Badge>
          </div>
          <div className="h-px bg-border" />
          <div className="space-y-1">
            {["10,000 API calls", "5 team members", "Priority support"].map(
              (f, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Check className="w-2.5 h-2.5 text-accent" />
                  <span className="text-[9px] text-muted-foreground">{f}</span>
                </div>
              ),
            )}
          </div>
          <div className="flex gap-1.5">
            <div className="flex-1 h-5 rounded bg-secondary text-[8px] font-medium flex items-center justify-center text-muted-foreground">
              Downgrade
            </div>
            <div className="flex-1 h-5 rounded bg-accent text-[8px] font-medium flex items-center justify-center text-accent-foreground">
              Upgrade
            </div>
          </div>
        </div>
      );
    }

    case "included-features": {
      const defaultFlags = [
        { name: "API Access", defaultValue: true },
        { name: "Webhooks", defaultValue: true },
        { name: "Custom Domain", defaultValue: false },
        { name: "SSO", defaultValue: false },
      ];
      const featureList = realData?.flags?.length
        ? realData.flags.slice(0, 4).map((f) => ({ name: f.name, defaultValue: f.defaultValue ?? false }))
        : defaultFlags;
      return (
        <div className="space-y-1.5">
          {featureList.map((f, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-[9px] text-foreground truncate pr-2">{f.name}</span>
              <div
                className={cn(
                  "w-5 h-3 rounded-full relative shrink-0",
                  f.defaultValue ? "bg-accent" : "bg-secondary",
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-2 h-2 rounded-full bg-white",
                    f.defaultValue ? "right-0.5" : "left-0.5",
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      );
    }

    case "metered-features":
      return (
        <div className="space-y-2">
          {[
            { name: "API Calls", used: 7500, limit: 10000 },
            { name: "Storage", used: 3.2, limit: 10 },
            { name: "Bandwidth", used: 45, limit: 100 },
          ].map((m, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex justify-between">
                <span className="text-[9px] text-foreground">{m.name}</span>
                <span className="text-[8px] text-muted-foreground">
                  {m.used.toLocaleString()}/{m.limit.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary">
                <div
                  className={cn(
                    "h-full rounded-full",
                    m.used / m.limit > 0.8 ? "bg-warning" : "bg-accent",
                  )}
                  style={{ width: `${(m.used / m.limit) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      );

    case "usage-dashboard":
      return (
        <div className="space-y-2">
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
                className="flex-1 rounded-sm bg-accent/30"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
      );

    case "next-bill-due":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-foreground">
              Next Payment
            </span>
            <span className="text-[9px] text-muted-foreground">in 12 days</span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-bold text-foreground">$29.00</span>
            <span className="text-[8px] text-muted-foreground">USDC</span>
          </div>
          <div className="h-1.5 rounded-full bg-secondary">
            <div className="h-full rounded-full bg-accent w-3/5" />
          </div>
          <p className="text-[8px] text-muted-foreground">
            Billing period: Mar 1 – Mar 31
          </p>
        </div>
      );

    case "payment-method":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 p-2 rounded-lg border border-border bg-secondary/20">
            <div className="w-8 h-5 rounded bg-foreground/10 flex items-center justify-center">
              <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-[9px] font-medium text-foreground">
                Wallet ••••4a2f
              </p>
              <p className="text-[8px] text-muted-foreground">Base network</p>
            </div>
            <Badge
              variant="secondary"
              className="text-[7px] h-3.5 bg-accent/10 text-accent"
            >
              Default
            </Badge>
          </div>
          <div className="h-5 rounded border border-dashed border-border flex items-center justify-center gap-1 text-muted-foreground">
            <Plus className="w-2.5 h-2.5" />
            <span className="text-[8px]">Add payment method</span>
          </div>
        </div>
      );

    case "invoices":
      return (
        <div className="space-y-1">
          <div className="grid grid-cols-4 text-[8px] font-medium text-muted-foreground pb-1 border-b border-border">
            <span>Invoice</span>
            <span>Date</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          {[
            { id: "INV-003", date: "Mar 1", amount: "$29.00", status: "Paid" },
            { id: "INV-002", date: "Feb 1", amount: "$29.00", status: "Paid" },
            { id: "INV-001", date: "Jan 1", amount: "$9.00", status: "Paid" },
          ].map((inv, i) => (
            <div
              key={i}
              className="grid grid-cols-4 text-[8px] py-1 border-b border-border/50 last:border-0"
            >
              <span className="text-foreground font-medium">{inv.id}</span>
              <span className="text-muted-foreground">{inv.date}</span>
              <span className="text-foreground">{inv.amount}</span>
              <Badge
                variant="secondary"
                className="text-[7px] h-3.5 w-fit bg-accent/10 text-accent"
              >
                {inv.status}
              </Badge>
            </div>
          ))}
        </div>
      );

    case "checkout-modal": {
      const selectedPlan = realData?.plans?.[1] ?? realData?.plans?.[0];
      const planName = selectedPlan?.name ?? "Pro Plan";
      const planPrice = selectedPlan ? `$${selectedPlan.price}` : "$29";
      const billingLabel = selectedPlan?.billingInterval === "yearly" ? "/yr" : "/mo";
      const token = selectedPlan?.acceptedToken ?? "USDC";
      const steps = ["Wallet", "Account", "Autopay", "Approve", "Subscribe"];
      const activeStep = 3; // show "Approve" state
      return (
        <div className="space-y-2">
          <div className="rounded-lg border border-accent/20 bg-card/80 p-2.5 space-y-2.5 shadow-sm">
            {/* Modal header */}
            <div className="flex items-center justify-between pb-1.5 border-b border-border">
              <span className="text-[10px] font-semibold text-foreground">Subscribe to {planName}</span>
              <div className="w-3.5 h-3.5 rounded-full bg-secondary/80 flex items-center justify-center text-[8px] text-muted-foreground cursor-pointer">✕</div>
            </div>
            {/* Step bar */}
            <div className="flex items-center gap-0.5">
              {steps.map((step, i) => (
                <React.Fragment key={i}>
                  <div className={cn(
                    "flex items-center justify-center w-4 h-4 rounded-full text-[7px] font-bold shrink-0",
                    i < activeStep ? "bg-accent text-accent-foreground" :
                    i === activeStep ? "bg-accent text-accent-foreground ring-1 ring-accent/40 ring-offset-1 ring-offset-card" :
                    "bg-secondary text-muted-foreground"
                  )}>
                    {i < activeStep ? "✓" : i + 1}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={cn("h-0.5 flex-1", i < activeStep ? "bg-accent/60" : "bg-border")} />
                  )}
                </React.Fragment>
              ))}
            </div>
            {/* Plan summary */}
            <div className="flex items-center justify-between p-1.5 rounded-md bg-secondary/40 border border-border">
              <div>
                <p className="text-[8px] text-muted-foreground">Subscribing to</p>
                <p className="text-[9px] font-semibold text-foreground">{planName}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-bold text-foreground">{planPrice}<span className="text-[7px] font-normal text-muted-foreground">{billingLabel}</span></p>
                <p className="text-[7px] text-muted-foreground">{token}</p>
              </div>
            </div>
            {/* Wallet + chain row */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-success/5 border border-success/20">
              <div className="w-4 h-4 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                <Check className="w-2.5 h-2.5 text-success" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] text-muted-foreground">Connected wallet</p>
                <p className="text-[8px] font-mono text-foreground truncate">0x4a2f…8c3d</p>
              </div>
              <div className="px-1.5 py-0.5 rounded bg-accent/10 text-[7px] font-medium text-accent shrink-0">Base</div>
            </div>
            {/* Approve step */}
            <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-warning/5 border border-warning/20">
              <div className="w-4 h-4 rounded-full bg-warning/20 flex items-center justify-center shrink-0 animate-pulse">
                <span className="text-[7px] font-bold text-warning">!</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[8px] font-medium text-foreground">Approve {token}</p>
                <p className="text-[7px] text-muted-foreground">Allow contract to charge {planPrice}{billingLabel}</p>
              </div>
            </div>
            {/* CTA */}
            <div className="h-6 rounded-md bg-accent text-[8px] font-semibold flex items-center justify-center text-accent-foreground">
              Approve &amp; Subscribe
            </div>
          </div>
        </div>
      );
    }

    case "billing-history":
      return (
        <div className="space-y-1.5">
          {[
            { event: "Plan upgraded to Pro", date: "Mar 1", type: "upgrade" },
            { event: "Payment $29.00", date: "Mar 1", type: "payment" },
            { event: "Payment $9.00", date: "Feb 1", type: "payment" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  item.type === "upgrade"
                    ? "bg-accent"
                    : "bg-muted-foreground/40",
                )}
              />
              <span className="text-[9px] text-foreground flex-1">
                {item.event}
              </span>
              <span className="text-[8px] text-muted-foreground">
                {item.date}
              </span>
            </div>
          ))}
        </div>
      );

    case "subscription-status":
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
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
            <div key={i} className={cn("flex-1 rounded p-1 space-y-0.5", i === 1 ? "bg-accent/20" : "bg-background/70")}>
              <div className="h-1 w-3/4 rounded bg-foreground/20" />
              <div className="h-2 w-1/2 rounded bg-foreground/30" />
              {[0,1,2].map((j) => <div key={j} className="h-0.5 w-full rounded bg-foreground/10 mt-0.5" />)}
              <div className={cn("h-2 rounded mt-0.5", i === 1 ? "bg-accent/60" : "bg-foreground/10")} />
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
          {[0,1,2].map((i) => <div key={i} className="flex items-center gap-1"><div className="w-1.5 h-1.5 rounded-full bg-accent/40" /><div className="h-1 flex-1 rounded bg-foreground/10" /></div>)}
          <div className="flex gap-1 mt-1">
            <div className="flex-1 h-2.5 rounded bg-foreground/10" />
            <div className="flex-1 h-2.5 rounded bg-accent/40" />
          </div>
        </div>
      );
    case "included-features":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          {[0,1,2,3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="h-1 w-2/3 rounded bg-foreground/15" />
              <div className={cn("w-4 h-2 rounded-full", i < 2 ? "bg-accent/50" : "bg-foreground/10")} />
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
                <div className="h-full rounded-full bg-accent/50" style={{ width: `${pct * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      );
    case "usage-dashboard":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          <div className="grid grid-cols-3 gap-1 mb-1">
            {[0,1,2].map((i) => <div key={i} className="h-4 rounded bg-foreground/10 flex flex-col items-center justify-center gap-0.5"><div className="h-1.5 w-3/4 rounded bg-foreground/20" /><div className="h-1 w-1/2 rounded bg-foreground/10" /></div>)}
          </div>
          <div className="flex items-end gap-0.5 h-5">
            {[50,70,40,80,60,90,65,75].map((h, i) => (
              <div key={i} className="flex-1 rounded-sm bg-accent/30" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      );
    case "next-bill-due":
      return (
        <div className="w-full px-3 scale-[0.85]">
          <div className="flex justify-between mb-1"><div className="h-1 w-2/5 rounded bg-foreground/20" /><div className="h-1 w-1/4 rounded bg-foreground/10" /></div>
          <div className="h-3 w-1/3 rounded bg-foreground/30 mb-1.5" />
          <div className="h-1.5 rounded-full bg-foreground/10"><div className="h-full rounded-full bg-accent/50 w-3/5" /></div>
        </div>
      );
    case "payment-method":
      return (
        <div className="w-full px-3 space-y-1 scale-[0.85]">
          <div className="flex items-center gap-1.5 p-1.5 rounded border border-accent/30 bg-accent/5">
            <div className="w-5 h-3 rounded bg-foreground/15" />
            <div className="flex-1 space-y-0.5"><div className="h-1 w-3/4 rounded bg-foreground/20" /><div className="h-0.5 w-1/2 rounded bg-foreground/10" /></div>
          </div>
          <div className="h-3 rounded border border-dashed border-foreground/15 flex items-center justify-center"><div className="h-1 w-1/2 rounded bg-foreground/10" /></div>
        </div>
      );
    case "invoices":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1">
          <div className="grid grid-cols-4 gap-1">{[0,1,2,3].map(i => <div key={i} className="h-1 rounded bg-foreground/20" />)}</div>
          {[0,1,2].map(i => <div key={i} className="grid grid-cols-4 gap-1">{[0,1,2,3].map(j => <div key={j} className="h-1 rounded bg-foreground/10" />)}</div>)}
        </div>
      );
    case "billing-history":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1.5">
          {[0,1,2].map(i => (
            <div key={i} className="flex items-center gap-1.5">
              <div className={cn("w-1.5 h-1.5 rounded-full", i === 0 ? "bg-accent/70" : "bg-foreground/20")} />
              <div className="h-1 flex-1 rounded bg-foreground/10" />
              <div className="h-1 w-6 rounded bg-foreground/10" />
            </div>
          ))}
        </div>
      );
    case "subscription-status":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1.5">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-accent/60 animate-pulse" /><div className="h-1.5 w-1/2 rounded bg-foreground/20" /></div>
          <div className="p-1.5 rounded bg-foreground/5 space-y-1">
            {[0,1,2].map(i => <div key={i} className="flex justify-between"><div className="h-1 w-1/3 rounded bg-foreground/10" /><div className="h-1 w-1/4 rounded bg-foreground/20" /></div>)}
          </div>
        </div>
      );
    case "checkout-modal":
      return (
        <div className="w-full px-3 scale-[0.85] space-y-1">
          <div className="flex justify-between mb-0.5"><div className="h-1.5 w-2/5 rounded bg-foreground/20" /><div className="w-2 h-2 rounded-full bg-foreground/10" /></div>
          <div className="flex gap-0.5 items-center">
            {[0,1,2,3,4].map((i) => <React.Fragment key={i}><div className={cn("w-3 h-3 rounded-full", i <= 2 ? "bg-accent/60" : "bg-foreground/10")} />{i<4&&<div className={cn("h-0.5 flex-1", i<2?"bg-accent/40":"bg-foreground/10")} />}</React.Fragment>)}
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
  realData?: RealData;
  onViewChange?: (vs: string) => void;
}

function SdkViewportPreview({
  componentId,
  viewState,
  styling,
  realData,
  onViewChange,
}: SdkViewportPreviewProps) {
  // Simulation state — checkout step, unsubscribe confirm, etc.
  const [checkoutStep, setCheckoutStep] = useState(0); // 0=plans 1=wallet 2=approve 3=success
  const [simCancelled, setSimCancelled] = useState(false);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(1);

  // Reset when switching view states
  useEffect(() => {
    setCheckoutStep(0);
    setSimCancelled(false);
  }, [viewState, componentId]);
  const defaultPlans = [
    { id: "s", name: "Starter", price: 9, billingInterval: "monthly", acceptedToken: "USDC" },
    { id: "p", name: "Pro", price: 29, billingInterval: "monthly", acceptedToken: "USDC" },
    { id: "e", name: "Enterprise", price: 99, billingInterval: "monthly", acceptedToken: "USDC" },
  ] as RealPlan[];
  const plans = realData?.plans?.length ? realData.plans.slice(0, 3) : defaultPlans;
  const activePlan = plans[selectedPlanIdx] ?? plans[0];
  const token = activePlan?.acceptedToken ?? "USDC";

  const primary = styling.primaryColor && styling.primaryColor !== "#000000" ? styling.primaryColor : "#6366f1";
  const radius = styling.cardStyle.borderRadius || "8px";
  const shadow = styling.cardStyle.cardShadow ? "0 4px 16px 0 rgb(0 0 0 / 0.08)" : "none";
  const padding = styling.cardStyle.cardPadding || "24px";
  const cardBg = styling.cardStyle.backgroundColor || undefined;
  const font = styling.typography.fontFamily || "inherit";

  const card: React.CSSProperties = { background: cardBg, borderRadius: radius, boxShadow: shadow, padding, border: "1px solid hsl(var(--border))", fontFamily: font };
  const btnPrimary: React.CSSProperties = { backgroundColor: primary, color: "#fff", borderRadius: `calc(${radius} - 2px)`, fontSize: 13, fontWeight: 600, padding: "10px 20px", cursor: "pointer", border: "none", display: "inline-block", fontFamily: font };
  const btnSecondary: React.CSSProperties = { backgroundColor: "hsl(var(--secondary))", color: "hsl(var(--foreground))", borderRadius: `calc(${radius} - 2px)`, fontSize: 13, fontWeight: 500, padding: "10px 20px", cursor: "pointer", border: "1px solid hsl(var(--border))", display: "inline-block", fontFamily: font };

  // ── helper: step bar (used in checkout) ──────────────────────
  const StepBar = ({ steps, active }: { steps: string[]; active: number }) => (
    <div className="flex items-center gap-1 mb-5">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          <div className="flex flex-col items-center gap-0.5">
            <div
              className="flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0"
              style={{
                backgroundColor: i < active ? primary : i === active ? primary : "hsl(var(--secondary))",
                color: i <= active ? "#fff" : "hsl(var(--muted-foreground))",
                opacity: i < active ? 0.7 : 1,
              }}
            >
              {i < active ? "✓" : i + 1}
            </div>
            <span className="text-[9px] text-muted-foreground whitespace-nowrap hidden sm:block">{step}</span>
          </div>
          {i < steps.length - 1 && (
            <div className="h-px flex-1 mt-[-10px]" style={{ backgroundColor: i < active ? primary : "hsl(var(--border))" }} />
          )}
        </React.Fragment>
      ))}
    </div>
  );

  const key = `${componentId}:${viewState}`;

  switch (key) {
    // ── customer-portal: Portal ───────────────────────────────
    case "customer-portal:portal": {
      const portalFlags = realData?.flags?.slice(0, 4) ?? [
        { featureKey: "api", name: "API Access", defaultValue: true },
        { featureKey: "hooks", name: "Webhooks", defaultValue: true },
        { featureKey: "domain", name: "Custom Domain", defaultValue: false },
        { featureKey: "sso", name: "SSO", defaultValue: false },
      ];
      return (
        <div style={{ fontFamily: font }} className="space-y-4 max-w-2xl mx-auto">
          {/* Active plan card */}
          <div style={card}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-base font-semibold text-foreground">{activePlan.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">${activePlan.price} / {activePlan.billingInterval === "yearly" ? "year" : "month"} · {token}</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${primary}15`, color: primary }}>Active</span>
            </div>
            <div className="h-px bg-border mb-4" />
            <div className="grid grid-cols-2 gap-2 mb-5">
              {portalFlags.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: f.defaultValue ? `${primary}18` : "hsl(var(--secondary))" }}>
                    {f.defaultValue && <Check className="w-2.5 h-2.5" style={{ color: primary }} />}
                  </div>
                  <span className="text-xs text-foreground">{f.name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button style={{ ...btnPrimary, flex: 1, textAlign: "center" }} onClick={() => onViewChange?.("checkout")}>Upgrade Plan</button>
              <button style={{ ...btnSecondary, flex: 1, textAlign: "center" }} onClick={() => onViewChange?.("payment-method")}>Manage Billing</button>
            </div>
            <button className="w-full mt-2 text-xs text-destructive hover:underline" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: font }} onClick={() => onViewChange?.("unsubscribe")}>Cancel subscription</button>
          </div>
          {/* Usage */}
          <div style={card}>
            <p className="text-sm font-semibold text-foreground mb-4">Usage This Period</p>
            {[{ name: "API Calls", used: 7_500, limit: 10_000, unit: "" }, { name: "Storage", used: 3.2, limit: 10, unit: " GB" }].map((m, i) => (
              <div key={i} className="mb-3 last:mb-0">
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-medium text-foreground">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.used}{m.unit} / {m.limit}{m.unit}</span>
                </div>
                <div className="h-2 rounded-full" style={{ background: "hsl(var(--secondary))" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${(m.used / m.limit) * 100}%`, backgroundColor: primary }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    // ── Checkout (multi-step simulation) ──────────────────────
    case "customer-portal:checkout":
    case "checkout:checkout":
    case "checkout-modal:checkout": {
      const steps = ["Select Plan", "Connect Wallet", "Approve", "Subscribe"];
      const chosenPlan = plans[selectedPlanIdx] ?? plans[0];

      // Step 0 — Plan selection
      if (checkoutStep === 0) {
        return (
          <div style={{ fontFamily: font }} className="max-w-2xl mx-auto space-y-4">
            <div style={card}>
              <p className="text-base font-semibold text-foreground mb-1">Choose a plan</p>
              <p className="text-xs text-muted-foreground mb-5">Select the plan that works for you</p>
              <StepBar steps={steps} active={0} />
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)` }}>
                {plans.map((plan, i) => (
                  <button
                    key={i}
                    onClick={() => setSelectedPlanIdx(i)}
                    style={{
                      border: selectedPlanIdx === i ? `2px solid ${primary}` : "1px solid hsl(var(--border))",
                      borderRadius: radius,
                      background: selectedPlanIdx === i ? `${primary}08` : "hsl(var(--secondary)/0.3)",
                      padding: "14px 12px",
                      cursor: "pointer",
                      textAlign: "left",
                      fontFamily: font,
                      boxShadow: selectedPlanIdx === i ? `0 0 0 3px ${primary}20` : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {i === 1 && <div className="text-[10px] font-semibold px-1.5 py-0.5 mb-2 w-fit rounded-full" style={{ backgroundColor: primary, color: "#fff" }}>Popular</div>}
                    <p className="text-sm font-semibold text-foreground">{plan.name}</p>
                    <p className="text-xl font-bold text-foreground mt-0.5">${plan.price}<span className="text-xs font-normal text-muted-foreground">/{plan.billingInterval === "yearly" ? "yr" : "mo"}</span></p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{plan.acceptedToken ?? "USDC"}</p>
                  </button>
                ))}
              </div>
              <button style={{ ...btnPrimary, width: "100%", textAlign: "center", marginTop: 20 }} onClick={() => setCheckoutStep(1)}>
                Continue with {chosenPlan.name} →
              </button>
            </div>
          </div>
        );
      }

      // Step 1 — Connect wallet
      if (checkoutStep === 1) {
        return (
          <div style={{ fontFamily: font }} className="max-w-md mx-auto">
            <div style={card}>
              <p className="text-base font-semibold text-foreground mb-1">Connect your wallet</p>
              <p className="text-xs text-muted-foreground mb-5">You need a wallet to subscribe on-chain</p>
              <StepBar steps={steps} active={1} />
              <div className="flex items-center justify-between p-3 mb-4 rounded-lg" style={{ background: "hsl(var(--secondary))", borderRadius: radius }}>
                <div><p className="text-[10px] text-muted-foreground">Subscribing to</p><p className="text-sm font-semibold text-foreground">{chosenPlan.name}</p></div>
                <div className="text-right"><p className="text-sm font-bold text-foreground">${chosenPlan.price}<span className="text-xs font-normal text-muted-foreground">/{chosenPlan.billingInterval === "yearly" ? "yr" : "mo"}</span></p><p className="text-xs text-muted-foreground">{token}</p></div>
              </div>
              <div className="space-y-2 mb-5">
                {["MetaMask", "Coinbase Wallet", "WalletConnect"].map((w, i) => (
                  <button key={i} onClick={() => setCheckoutStep(2)} style={{ width: "100%", border: "1px solid hsl(var(--border))", borderRadius: radius, padding: "10px 14px", cursor: "pointer", background: "hsl(var(--secondary)/0.4)", fontFamily: font, display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${primary}15` }}>
                      <CreditCard className="w-3.5 h-3.5" style={{ color: primary }} />
                    </div>
                    <span className="text-sm font-medium text-foreground">{w}</span>
                  </button>
                ))}
              </div>
              <button style={{ ...btnSecondary, width: "100%", textAlign: "center" }} onClick={() => setCheckoutStep(0)}>← Back</button>
            </div>
          </div>
        );
      }

      // Step 2 — Approve token
      if (checkoutStep === 2) {
        return (
          <div style={{ fontFamily: font }} className="max-w-md mx-auto">
            <div style={card}>
              <p className="text-base font-semibold text-foreground mb-1">Approve {token}</p>
              <p className="text-xs text-muted-foreground mb-5">Allow the contract to charge your wallet</p>
              <StepBar steps={steps} active={2} />
              <div className="flex items-center gap-2.5 p-3 mb-3 rounded-lg" style={{ background: "hsl(var(--secondary)/0.5)", border: "1px solid hsl(var(--border))", borderRadius: radius }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${primary}18` }}>
                  <Check className="w-4 h-4" style={{ color: primary }} />
                </div>
                <div><p className="text-[10px] text-muted-foreground">Connected wallet</p><p className="text-xs font-mono text-foreground">0x4a2f…8c3d · Base</p></div>
              </div>
              <div className="flex items-center gap-2.5 p-3 mb-5 rounded-lg" style={{ background: "hsl(var(--warning)/0.06)", border: "1px solid hsl(var(--warning)/0.25)", borderRadius: radius }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 animate-pulse" style={{ background: "hsl(var(--warning)/0.15)" }}>
                  <span className="text-[11px] font-bold text-warning">!</span>
                </div>
                <div><p className="text-xs font-semibold text-foreground">Approve {token} spending</p><p className="text-[10px] text-muted-foreground">Max charge: ${chosenPlan.price}/{chosenPlan.billingInterval === "yearly" ? "yr" : "mo"}</p></div>
              </div>
              <button style={{ ...btnPrimary, width: "100%", textAlign: "center" }} onClick={() => setCheckoutStep(3)}>Approve &amp; Subscribe</button>
              <button style={{ ...btnSecondary, width: "100%", textAlign: "center", marginTop: 8 }} onClick={() => setCheckoutStep(1)}>← Back</button>
            </div>
          </div>
        );
      }

      // Step 3 — Success
      return (
        <div style={{ fontFamily: font }} className="max-w-sm mx-auto">
          <div style={{ ...card, textAlign: "center" }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: primary }}>
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="text-base font-semibold text-foreground mb-1">You&apos;re subscribed!</p>
            <p className="text-xs text-muted-foreground mb-1">Now on the <strong>{chosenPlan.name}</strong> plan.</p>
            <p className="text-xs text-muted-foreground mb-6">Transaction confirmed on Base · <span className="font-mono">0x4a2f…</span></p>
            <button style={{ ...btnPrimary, minWidth: 160 }} onClick={() => { setCheckoutStep(0); onViewChange?.("portal"); }}>Go to Portal</button>
          </div>
        </div>
      );
    }

    // ── Payment Method ─────────────────────────────────────────
    case "customer-portal:payment-method": {
      const wallets = [
        { addr: "0x4a2f…8c3d", network: "Base", isDefault: true },
        { addr: "0x9b1e…2af1", network: "Ethereum", isDefault: false },
      ];
      return (
        <div style={{ fontFamily: font }} className="max-w-md mx-auto">
          <div style={card}>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-foreground">Payment Methods</p>
              <button style={{ ...btnPrimary, fontSize: 11, padding: "5px 12px" }}>+ Add Wallet</button>
            </div>
            <div className="space-y-2 mb-2">
              {wallets.map((w, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg" style={{ border: w.isDefault ? `1.5px solid ${primary}` : "1px solid hsl(var(--border))", background: w.isDefault ? `${primary}06` : "hsl(var(--secondary)/0.3)", borderRadius: radius }}>
                  <div className="w-10 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--secondary))" }}>
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground font-mono">{w.addr}</p>
                    <p className="text-xs text-muted-foreground">{w.network} · ERC-20</p>
                  </div>
                  {w.isDefault
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${primary}18`, color: primary }}>Default</span>
                    : <button className="text-[10px] text-muted-foreground hover:text-foreground" style={{ background: "none", border: "none", cursor: "pointer" }}>Set default</button>
                  }
                </div>
              ))}
            </div>
            <div className="h-px bg-border mt-4 mb-3" />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Autopay enabled · charges on renewal</p>
              <div className="w-9 h-5 rounded-full flex items-center relative" style={{ backgroundColor: primary }}>
                <div className="absolute right-0.5 w-4 h-4 rounded-full bg-white shadow-sm" />
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ── Unsubscribe ────────────────────────────────────────────
    case "customer-portal:unsubscribe": {
      if (simCancelled) {
        return (
          <div style={{ fontFamily: font }} className="max-w-sm mx-auto">
            <div style={{ ...card, textAlign: "center" }}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "hsl(var(--secondary))" }}>
                <Check className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">Subscription cancelled</p>
              <p className="text-xs text-muted-foreground mb-5">You have access until the end of this billing period.</p>
              <button style={{ ...btnSecondary, minWidth: 140 }} onClick={() => { setSimCancelled(false); onViewChange?.("portal"); }}>Back to Portal</button>
            </div>
          </div>
        );
      }
      return (
        <div style={{ fontFamily: font }} className="max-w-md mx-auto">
          <div style={{ ...card, textAlign: "center" }}>
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: "hsl(var(--destructive)/0.08)" }}>
              <X className="w-6 h-6 text-destructive" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">Cancel your subscription?</p>
            <p className="text-xs text-muted-foreground mb-2 max-w-xs mx-auto">You&apos;re currently on the <strong>{activePlan.name}</strong> plan. You&apos;ll lose access to these features:</p>
            <div className="text-left mb-5 space-y-1 px-2">
              {(realData?.flags?.slice(0, 3) ?? [{ name: "API Access" }, { name: "Webhooks" }, { name: "Priority Support" }]).map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <X className="w-3 h-3 text-destructive shrink-0" />
                  <span className="text-xs text-muted-foreground">{f.name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button style={{ ...btnPrimary, flex: 1, textAlign: "center" }} onClick={() => onViewChange?.("portal")}>Keep Plan</button>
              <button
                style={{ flex: 1, borderRadius: radius, padding: "10px 20px", fontSize: 13, fontWeight: 600, backgroundColor: "hsl(var(--destructive))", color: "#fff", cursor: "pointer", border: "none", fontFamily: font }}
                onClick={() => setSimCancelled(true)}
              >Cancel Subscription</button>
            </div>
          </div>
        </div>
      );
    }

    // ── Disabled / locked ──────────────────────────────────────
    case "customer-portal:disabled":
    case "pricing-table:disabled": {
      const lockedFeatures = realData?.flags?.slice(0, 3) ?? [{ name: "Custom Domain" }, { name: "SSO" }, { name: "Priority Support" }];
      return (
        <div style={{ fontFamily: font }} className="max-w-md mx-auto">
          <div style={card}>
            <div className="flex items-start gap-3 mb-4 p-3 rounded-lg" style={{ background: "hsl(var(--secondary))", borderRadius: radius }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--border))" }}>
                <Shield className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Access Restricted</p>
                <p className="text-xs text-muted-foreground mt-0.5">These features require a higher plan</p>
              </div>
            </div>
            <div className="space-y-2.5 mb-5">
              {lockedFeatures.map((f, i) => (
                <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg opacity-50" style={{ border: "1px solid hsl(var(--border))", borderRadius: radius }}>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: "hsl(var(--border))" }}>
                    <Shield className="w-2.5 h-2.5 text-muted-foreground" />
                  </div>
                  <span className="text-xs text-foreground">{f.name}</span>
                  <span className="ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">Locked</span>
                </div>
              ))}
            </div>
            <button style={{ ...btnPrimary, width: "100%", textAlign: "center" }} onClick={() => onViewChange?.("checkout")}>Upgrade to Unlock</button>
          </div>
        </div>
      );
    }

    // ── checkout-modal aliases ─────────────────────────────────
    case "checkout-modal:plans":
    case "checkout:plans":
    case "pricing-table:plans": {
      return (
        <div style={{ fontFamily: font }} className="max-w-2xl mx-auto space-y-4">
          <div className="text-center mb-2">
            <p className="text-base font-semibold text-foreground">Choose your plan</p>
            <p className="text-xs text-muted-foreground mt-1">Billed in {token} · cancel anytime</p>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, 1fr)` }}>
            {plans.map((plan, i) => {
              const isPopular = i === 1;
              return (
                <div key={i} style={{ border: isPopular ? `2px solid ${primary}` : "1px solid hsl(var(--border))", borderRadius: radius, background: isPopular ? `${primary}06` : cardBg, boxShadow: isPopular ? `0 0 0 4px ${primary}14` : shadow, padding }}>
                  {isPopular && <div className="text-[10px] font-semibold px-2 py-0.5 mb-3 w-fit rounded-full" style={{ backgroundColor: primary, color: "#fff" }}>Most Popular</div>}
                  <p className="text-sm font-semibold text-foreground mb-1">{plan.name}</p>
                  <p className="text-2xl font-bold text-foreground mb-0.5">${plan.price}<span className="text-sm font-normal text-muted-foreground">/{plan.billingInterval === "yearly" ? "yr" : "mo"}</span></p>
                  <p className="text-xs text-muted-foreground mb-4">{plan.acceptedToken ?? "USDC"}</p>
                  <div className="space-y-2 mb-5">
                    {(realData?.flags?.slice(0, 3) ?? [{ featureKey: "f1", name: "API Access", defaultValue: true }, { featureKey: "f2", name: "Webhooks", defaultValue: i >= 1 }, { featureKey: "f3", name: "SSO", defaultValue: i >= 2 }]).map((f, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <div className="w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: f.defaultValue ? `${primary}20` : "hsl(var(--secondary))" }}>
                          {f.defaultValue && <Check className="w-2.5 h-2.5" style={{ color: primary }} />}
                        </div>
                        <span className="text-xs text-foreground">{f.name}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => { setSelectedPlanIdx(i); setCheckoutStep(1); onViewChange?.("checkout"); }}
                    style={{ width: "100%", borderRadius: `calc(${radius} - 2px)`, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer", border: isPopular ? "none" : "1px solid hsl(var(--border))", backgroundColor: isPopular ? primary : "hsl(var(--secondary))", color: isPopular ? "#fff" : "hsl(var(--foreground))", textAlign: "center", fontFamily: font }}
                  >{isPopular ? "Get Started" : "Select"}</button>
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
            <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: primary }}>
              <Check className="w-8 h-8 text-white" />
            </div>
            <p className="text-base font-semibold text-foreground mb-1">You&apos;re subscribed!</p>
            <p className="text-xs text-muted-foreground mb-1">Now on the <strong>{donePlan.name}</strong> plan.</p>
            <p className="text-xs text-muted-foreground mb-6">Transaction confirmed on Base.</p>
            <button style={{ ...btnPrimary, minWidth: 160 }} onClick={() => { setCheckoutStep(0); onViewChange?.("portal"); }}>Go to Portal</button>
          </div>
        </div>
      );
    }

    // ── plan-manager: Active ───────────────────────────────────
    case "plan-manager:active": {
      const planFeatures = realData?.flags?.slice(0, 3) ?? [{ featureKey: "f1", name: "API Access", defaultValue: true }, { featureKey: "f2", name: "Webhooks", defaultValue: true }, { featureKey: "f3", name: "Priority Support", defaultValue: true }];
      return (
        <div style={{ fontFamily: font }} className="max-w-md mx-auto">
          <div style={card}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-sm font-semibold text-foreground">{activePlan.name}</p>
                <p className="text-xs text-muted-foreground">${activePlan.price}/{activePlan.billingInterval === "yearly" ? "yr" : "mo"} · {token}</p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: `${primary}15`, color: primary }}>Active</span>
            </div>
            <div className="space-y-2 mb-5">
              {planFeatures.map((f, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 shrink-0" style={{ color: primary }} />
                  <span className="text-xs text-foreground">{f.name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button style={{ ...btnSecondary, flex: 1, textAlign: "center", fontSize: 12, padding: "8px 0" }} onClick={() => onViewChange?.("unsubscribe")}>Downgrade</button>
              <button style={{ ...btnPrimary, flex: 1, textAlign: "center", fontSize: 12, padding: "8px 0" }} onClick={() => onViewChange?.("checkout")}>Upgrade</button>
            </div>
          </div>
        </div>
      );
    }

    default:
      return (
        <div className="flex items-center justify-center h-40">
          <p className="text-xs text-muted-foreground">No preview for this state.</p>
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
  realData?: RealData;
}

export function ComponentEditor({
  component,
  onClose,
  onSave,
  realData,
}: ComponentEditorProps) {
  const [activeView, setActiveView] = useState<"component" | "code">("component");
  const [config, setConfig] = useState<ComponentConfig>(component);
  const [elements, setElements] = useState<ComponentElement[]>(component.elements);
  const [draggedElement, setDraggedElement] = useState<ComponentElement | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);

  const isCustom = config.type === "custom";

  // Both custom AND SDK components use the same view states.
  // Custom components use customer-portal views (Portal = their assembled elements, rest = standard flows).
  // SDK components use their own view map.
  const componentViews =
    isCustom
      ? COMPONENT_VIEWS["customer-portal"]
      : (COMPONENT_VIEWS[component.id] ?? COMPONENT_VIEWS[component.template] ?? COMPONENT_VIEWS["customer-portal"]);

  const [activeViewState, setActiveViewState] = useState<string>(componentViews[0]?.id ?? "portal");

  // Collapsible design panel sections
  const [openSections, setOpenSections] = useState({ elements: true, general: true, cardStyling: false, typography: false });
  const toggleSection = (k: keyof typeof openSections) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

  // Element picker (inside design panel for custom components)
  const [showElementPicker, setShowElementPicker] = useState(false);

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
    const hasCheckoutModal = elements.some((el) => el.type === "checkout-modal");

    elements.forEach((el) => {
      const componentName = el.type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
      imports.add(componentName);
    });

    const reactImports = hasCheckoutModal ? `import { useState } from 'react';\n` : "";

    return `${reactImports}import { ${Array.from(imports).join(", ")}, MEAPProvider } from '@meap/react';

export function ${config.name.replace(/\s+/g, "")}() {${hasCheckoutModal ? `
  const [checkoutOpen, setCheckoutOpen] = useState(false);` : ""}
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
  const updateCardStyle = (patch: Partial<ComponentConfig["styling"]["cardStyle"]>) =>
    setConfig((c) => ({ ...c, styling: { ...c.styling, cardStyle: { ...c.styling.cardStyle, ...patch } } }));
  const updateTypography = (patch: Partial<ComponentConfig["styling"]["typography"]>) =>
    setConfig((c) => ({ ...c, styling: { ...c.styling, typography: { ...c.styling.typography, ...patch } } }));

  // ── Design Panel (right sidebar) — unified for SDK + custom ──
  const designPanel = (
    <div className="w-64 border-l border-border overflow-y-auto bg-background shrink-0 flex flex-col">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <p className="text-xs font-semibold text-foreground">Design</p>
      </div>

      {/* Component name */}
      <div className="px-4 py-3 border-b border-border shrink-0">
        <Label htmlFor="comp-name" className="text-xs text-muted-foreground mb-1 block">
          Name
        </Label>
        <Input
          id="comp-name"
          value={config.name}
          onChange={(e) => setConfig({ ...config, name: e.target.value })}
          className="h-8 text-xs"
        />
      </div>

      {/* Elements — custom components only */}
      {isCustom && (
        <DesignSection
          title="Elements"
          open={openSections.elements}
          onToggle={() => toggleSection("elements")}
        >
          {elements.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">No elements added yet.</p>
          ) : (
            <div className="space-y-1 mb-2">
              {elements.map((el, index) => {
                const Icon = el.icon;
                return (
                  <div key={el.id} className="flex items-center gap-2 py-1 group">
                    <div className="w-4 h-4 rounded flex items-center justify-center bg-accent/10 shrink-0">
                      <Icon className="w-2.5 h-2.5 text-accent" />
                    </div>
                    <span className="text-xs text-foreground flex-1 truncate">{el.label}</span>
                    <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => moveElement(index, "up")}
                        disabled={index === 0}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
                      >
                        <ChevronUp className="w-3 h-3 text-muted-foreground" />
                      </button>
                      <button
                        onClick={() => moveElement(index, "down")}
                        disabled={index === elements.length - 1}
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
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
          )}
          {/* Add element */}
          <button
            onClick={() => setShowElementPicker((v) => !v)}
            className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg border border-dashed border-border hover:border-accent/50 hover:bg-secondary/30 transition-all text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            {showElementPicker ? "Hide elements" : "Add element"}
          </button>
          {showElementPicker && (
            <div className="mt-2 space-y-3 max-h-64 overflow-y-auto">
              {ELEMENT_LIBRARY.map((cat) => (
                <div key={cat.category}>
                  <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    {cat.category}
                  </p>
                  <div className="space-y-0.5">
                    {cat.elements.map((el) => {
                      const Icon = el.icon;
                      const isAdded = elements.some((e) => e.type === el.type);
                      return (
                        <button
                          key={el.type}
                          onClick={() => { if (!isAdded) { addElement(el); } }}
                          disabled={isAdded}
                          className={cn(
                            "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-xs transition-all",
                            isAdded
                              ? "text-accent bg-accent/5 cursor-default"
                              : "text-foreground hover:bg-secondary cursor-pointer",
                          )}
                        >
                          <div className={cn("w-4 h-4 rounded flex items-center justify-center shrink-0", isAdded ? "bg-accent/15" : "bg-secondary")}>
                            <Icon className={cn("w-2.5 h-2.5", isAdded ? "text-accent" : "text-muted-foreground")} />
                          </div>
                          <span className="flex-1 text-left">{el.label}</span>
                          {isAdded && <Check className="w-3 h-3 text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DesignSection>
      )}

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
            onChange={(e) => updateStyling({ primaryColor: e.target.value })}
            className="w-8 h-7 p-0.5 cursor-pointer rounded"
          />
          <Input
            value={config.styling.primaryColor}
            onChange={(e) => updateStyling({ primaryColor: e.target.value })}
            className="h-7 w-20 font-mono text-xs"
          />
        </DesignRow>
        <DesignRow label="Secondary Color">
          <Input
            type="color"
            value={config.styling.secondaryColor}
            onChange={(e) => updateStyling({ secondaryColor: e.target.value })}
            className="w-8 h-7 p-0.5 cursor-pointer rounded"
          />
          <Input
            value={config.styling.secondaryColor}
            onChange={(e) => updateStyling({ secondaryColor: e.target.value })}
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
            onChange={(e) => updateCardStyle({ backgroundColor: e.target.value })}
            className="w-8 h-7 p-0.5 cursor-pointer rounded"
          />
          <Input
            value={config.styling.cardStyle.backgroundColor || ""}
            onChange={(e) => updateCardStyle({ backgroundColor: e.target.value })}
            className="h-7 w-20 font-mono text-xs"
            placeholder="auto"
          />
        </DesignRow>
        <DesignRow label="Border Radius">
          <Input
            value={config.styling.cardStyle.borderRadius}
            onChange={(e) => updateCardStyle({ borderRadius: e.target.value })}
            className="h-7 w-[108px] text-xs"
            placeholder="8px"
          />
        </DesignRow>
        <DesignRow label="Card Shadow">
          <button
            onClick={() => updateCardStyle({ cardShadow: !config.styling.cardStyle.cardShadow })}
            className={cn(
              "w-9 h-5 rounded-full relative transition-colors",
              config.styling.cardStyle.cardShadow ? "bg-accent" : "bg-secondary",
            )}
          >
            <div
              className={cn(
                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
                config.styling.cardStyle.cardShadow ? "right-0.5" : "left-0.5",
              )}
            />
          </button>
        </DesignRow>
        <DesignRow label="Card Padding">
          <Input
            value={config.styling.cardStyle.cardPadding}
            onChange={(e) => updateCardStyle({ cardPadding: e.target.value })}
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
  );

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const editorContent = (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="gap-2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
            Close
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{config.name}</h2>
            <p className="text-xs text-muted-foreground">
              {config.type === "sdk" ? "SDK Component" : "Custom Component"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Component | Code switcher */}
          <div className="flex items-center gap-0.5 bg-secondary/50 rounded-lg p-0.5">
            {(["component", "code"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setActiveView(v)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 capitalize",
                  activeView === v
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "component" ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
                {v === "component" ? "Component" : "Code"}
              </button>
            ))}
          </div>
          <div className="h-6 w-px bg-border" />
          <Button variant="outline" size="sm" onClick={downloadCode} className="gap-2 text-xs">
            <Download className="w-3.5 h-3.5" />
            Export
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="gap-2 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* ── COMPONENT view — unified layout for SDK + custom ── */}
        {activeView === "component" && (
          <div className="flex flex-1 min-w-0">
            {/* Viewport area */}
            <div className="flex-1 flex flex-col min-w-0 bg-secondary/5">
              {/* View-state tab bar — identical for both SDK and custom */}
              <div className="flex items-center border-b border-border px-6 shrink-0 bg-background">
                {componentViews.map((vs) => (
                  <button
                    key={vs.id}
                    onClick={() => setActiveViewState(vs.id)}
                    className={cn(
                      "px-4 py-3 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                      activeViewState === vs.id
                        ? "border-accent text-accent"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {vs.label}
                  </button>
                ))}
              </div>
              {/* Viewport frame */}
              <div className="flex-1 overflow-y-auto p-8 bg-secondary/5">
                <div className="max-w-3xl mx-auto">
                  {/* Browser chrome */}
                  <div className="rounded-t-xl border border-b-0 border-border bg-secondary/40 flex items-center gap-2 px-4 py-2.5">
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
                      <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
                      <div className="w-2.5 h-2.5 rounded-full bg-muted-foreground/20" />
                    </div>
                    <div className="flex-1 h-5 rounded bg-background/70 border border-border/50" />
                    <Badge variant="secondary" className="text-[9px] h-4 bg-accent/10 text-accent border-0">
                      Live Preview
                    </Badge>
                  </div>
                  <div className="border border-border rounded-b-xl bg-background p-8 min-h-[420px]">
                    {/*
                     * Unified viewport — same rendering logic for both types.
                     * Portal tab on custom: show the user's assembled elements.
                     * All other tabs (Checkout, Payment Method, etc.): SdkViewportPreview.
                     * SDK components: always SdkViewportPreview.
                     */}
                    {isCustom && activeViewState === "portal" ? (
                      elements.length === 0 ? (
                        /* Empty state — nudge user to add elements */
                        <div className="flex flex-col items-center justify-center h-56 select-none">
                          <div className="w-14 h-14 rounded-2xl bg-secondary/60 flex items-center justify-center mb-4 border border-border">
                            <LayoutTemplate className="w-6 h-6 text-muted-foreground/50" />
                          </div>
                          <p className="text-sm font-semibold text-foreground mb-1">No elements yet</p>
                          <p className="text-xs text-muted-foreground mb-5 text-center max-w-[200px]">
                            Add billing elements via the Design panel →
                          </p>
                          <div className="flex flex-wrap gap-2 justify-center">
                            {["pricing-table", "plan-manager", "metered-features"].map((type) => {
                              const el = ALL_ELEMENTS.find((e) => e.type === type);
                              if (!el) return null;
                              const Icon = el.icon;
                              return (
                                <button
                                  key={type}
                                  onClick={() => addElement(el)}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/70 border border-border text-xs font-medium text-foreground transition-colors"
                                >
                                  <Icon className="w-3 h-3 text-muted-foreground" />
                                  {el.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        /* Custom portal: drag-and-drop canvas with element cards */
                        <div
                          onDrop={handleDrop}
                          onDragOver={handleDragOver}
                          className={cn(
                            "min-h-[320px] rounded-lg transition-all duration-150",
                            draggedElement && "ring-2 ring-accent/40 bg-accent/5",
                          )}
                        >
                          <div
                            className="grid gap-4"
                            style={{
                              gridTemplateColumns:
                                config.styling.sections === "merged"
                                  ? "1fr"
                                  : `repeat(${Math.min(config.styling.columns, elements.length)}, 1fr)`,
                            }}
                          >
                            {elements.map((element, index) => {
                              const Icon = element.icon;
                              const accentColor = config.styling.primaryColor && config.styling.primaryColor !== "#000000"
                                ? config.styling.primaryColor : "#6366f1";
                              return (
                                <div
                                  key={element.id}
                                  style={{
                                    borderRadius: config.styling.cardStyle.borderRadius || undefined,
                                    backgroundColor: config.styling.cardStyle.backgroundColor || undefined,
                                    boxShadow: config.styling.cardStyle.cardShadow ? "0 2px 12px 0 rgb(0 0 0/0.07)" : "none",
                                    fontFamily: config.styling.typography.fontFamily || undefined,
                                  }}
                                  className={cn(
                                    "group relative rounded-xl border transition-all cursor-pointer",
                                    selectedElement === element.id
                                      ? "border-accent ring-1 ring-accent/20"
                                      : "border-border hover:border-accent/40",
                                  )}
                                  onClick={() => setSelectedElement(element.id)}
                                >
                                  <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60 bg-secondary/20 rounded-t-xl">
                                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 cursor-move opacity-0 group-hover:opacity-100 transition-opacity" />
                                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: `${accentColor}18` }}>
                                      <Icon className="w-3 h-3" style={{ color: accentColor }} />
                                    </div>
                                    <span className="text-xs font-medium text-foreground flex-1">{element.label}</span>
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button onClick={(e) => { e.stopPropagation(); moveElement(index, "up"); }} disabled={index === 0} className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30">
                                        <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); moveElement(index, "down"); }} disabled={index === elements.length - 1} className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30">
                                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                      </button>
                                      <button onClick={(e) => { e.stopPropagation(); removeElement(element.id); }} className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10">
                                        <Trash2 className="w-3 h-3 text-destructive" />
                                      </button>
                                    </div>
                                  </div>
                                  <div className="p-4">
                                    <ElementPreview type={element.type} realData={realData} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          {/* Drop target hint at bottom */}
                          {draggedElement && (
                            <div className="mt-3 h-10 rounded-lg border-2 border-dashed border-accent/50 flex items-center justify-center">
                              <span className="text-xs text-accent font-medium">Drop here to add</span>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      /* SDK components + all non-Portal tabs of custom: unified SdkViewportPreview */
                      <SdkViewportPreview
                        componentId={isCustom ? "customer-portal" : component.id}
                        viewState={activeViewState}
                        styling={config.styling}
                        realData={realData}
                        onViewChange={(vs) => setActiveViewState(vs)}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
            {/* Design panel — always on right */}
            {designPanel}
          </div>
        )}


        {/* ── CODE view ──────────────────────────────────── */}
        {activeView === "code" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Installation Code</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Embed this component in your app</p>
              </div>

              {/* React / Next.js */}
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
                  <span className="text-xs font-semibold text-foreground">React / Next.js</span>
                  <Button variant="ghost" size="sm" onClick={copyCode} className="h-7 gap-1.5 text-xs">
                    {copiedCode ? (
                      <><Check className="w-3 h-3" />Copied</>
                    ) : (
                      <><Copy className="w-3 h-3" />Copy</>
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
                  <span className="text-xs font-semibold text-foreground">Setup Instructions</span>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2">1. Install Dependencies</p>
                    <pre className="bg-secondary/30 p-3 rounded-lg text-xs font-mono border border-border">
                      npm install @meap/react @meap/core wagmi viem
                    </pre>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground mb-2">2. Configure Provider</p>
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
                    <p className="text-xs font-semibold text-foreground mb-1">3. Use Component</p>
                    <p className="text-xs text-muted-foreground">
                      Copy the React code above and paste it into your application. The component will
                      automatically connect to your Web3 subscription infrastructure.
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
