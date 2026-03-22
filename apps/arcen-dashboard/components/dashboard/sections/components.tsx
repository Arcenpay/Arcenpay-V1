"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Plus,
  Trash2,
  Layers,
  ReceiptText,
  CreditCard,
  BarChart3,
  Shield,
  Copy,
  Code2,
  Eye,
  Clock,
  ShieldCheck,
  ArrowRight,
  History,
  Zap,
} from "lucide-react";
import {
  ComponentEditor,
  type ComponentConfig,
  type RealData,
  type RealPlan,
  type RealFlag,
} from "@/components/dashboard/component-editor";
import { cn } from "@/lib/utils";

// ============================================================
// Pre-built SDK Components (4 key components like SchematicHQ)
// ============================================================

const DEFAULT_SDK_COMPONENTS: ComponentConfig[] = [
  {
    id: "customer-portal",
    name: "Customer Portal",
    description:
      "All-in-one portal for users to manage plans, billing, and subscriptions",
    type: "sdk",
    category: "Portal",
    elements: [
      {
        id: "1",
        type: "plan-manager",
        label: "Plan Manager",
        icon: Layers,
        props: {},
      },
      {
        id: "2",
        type: "next-bill-due",
        label: "Next Bill Due",
        icon: Clock,
        props: {},
      },
      {
        id: "3",
        type: "payment-method",
        label: "Payment Method",
        icon: CreditCard,
        props: {},
      },
      {
        id: "4",
        type: "invoices",
        label: "Invoices",
        icon: ReceiptText,
        props: {},
      },
    ],
    styling: {
      columns: 2,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "customer-portal",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "checkout",
    name: "Checkout",
    description: "Simple checkout flow with plan selection and payment",
    type: "sdk",
    category: "Checkout",
    elements: [
      {
        id: "1",
        type: "pricing-table",
        label: "Pricing Table",
        icon: Layers,
        props: {},
      },
      {
        id: "2",
        type: "payment-method",
        label: "Payment Method",
        icon: CreditCard,
        props: {},
      },
    ],
    styling: {
      columns: 2,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "checkout",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "pricing-table",
    name: "Pricing Table",
    description:
      "Display subscription plans with real-time pricing and feature comparison",
    type: "sdk",
    category: "Billing",
    elements: [
      {
        id: "1",
        type: "pricing-table",
        label: "Pricing Table",
        icon: Layers,
        props: {},
      },
    ],
    styling: {
      columns: 3,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "blank",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "usage-dashboard",
    name: "Usage Dashboard",
    description:
      "Real-time usage metrics, metered features, and consumption analytics",
    type: "sdk",
    category: "Usage",
    elements: [
      {
        id: "1",
        type: "usage-dashboard",
        label: "Usage Dashboard",
        icon: BarChart3,
        props: {},
      },
      {
        id: "2",
        type: "metered-features",
        label: "Metered Features",
        icon: BarChart3,
        props: {},
      },
      {
        id: "3",
        type: "subscription-status",
        label: "Subscription Status",
        icon: Shield,
        props: {},
      },
    ],
    styling: {
      columns: 2,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "usage-portal",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "checkout-modal",
    name: "Checkout Modal",
    description:
      "Multi-step upgrade flow: plan selection → on-chain subscribe transaction → confirmation",
    type: "sdk",
    category: "Checkout",
    elements: [
      {
        id: "1",
        type: "checkout-modal",
        label: "Checkout Modal",
        icon: Zap,
        props: {},
      },
    ],
    styling: {
      columns: 1,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "checkout",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "billing-history",
    name: "Billing History",
    description:
      "On-chain subscription events and payment history from SubscriptionRegistry logs",
    type: "sdk",
    category: "Billing",
    elements: [
      {
        id: "1",
        type: "billing-history",
        label: "Billing History",
        icon: History,
        props: {},
      },
    ],
    styling: {
      columns: 1,
      sections: "merged",
      primaryColor: "#6366f1",
      secondaryColor: "#e0e7ff",
      cardStyle: {
        backgroundColor: "#FFFFFF",
        borderRadius: "10px",
        cardShadow: true,
        cardPadding: "45px",
      },
      typography: {
        fontFamily: "Inter",
        fontSize: "14px",
      },
    },
    template: "blank",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
];

// ============================================================
// Preview mockups for each component type
// ============================================================

function CustomerPortalPreview() {
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="h-2 w-16 rounded bg-foreground/10" />
        <div className="h-5 w-14 rounded-md bg-accent/15 flex items-center justify-center">
          <span className="text-[8px] font-medium text-accent">Pro Plan</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-accent/20" />
            <div className="h-1.5 w-10 rounded bg-foreground/10" />
          </div>
          <div className="h-1.5 w-full rounded bg-foreground/5" />
          <div className="h-1.5 w-3/4 rounded bg-foreground/5" />
        </div>
        <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded bg-accent/20" />
            <div className="h-1.5 w-10 rounded bg-foreground/10" />
          </div>
          <div className="h-1.5 w-full rounded bg-foreground/5" />
          <div className="h-1.5 w-2/3 rounded bg-foreground/5" />
        </div>
      </div>
      <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="h-1.5 w-12 rounded bg-foreground/10" />
          <div className="h-1.5 w-8 rounded bg-accent/20" />
        </div>
        <div className="h-1.5 w-full rounded bg-foreground/5" />
      </div>
    </div>
  );
}

function CheckoutPreview({ plans }: { plans: RealPlan[] }) {
  const planList = plans.length
    ? plans.slice(0, 3)
    : [
        { id: "1", name: "Starter", price: 9, billingInterval: "monthly" },
        { id: "2", name: "Pro", price: 29, billingInterval: "monthly" },
        { id: "3", name: "Enterprise", price: 99, billingInterval: "monthly" },
      ];
  return (
    <div className="space-y-2 p-3">
      <div className="h-2 w-20 rounded bg-foreground/10" />
      <div className="flex gap-2">
        {planList.map((plan, i) => (
          <div
            key={plan.id}
            className={cn(
              "flex-1 rounded-md border p-2 space-y-1.5",
              i === 1
                ? "border-accent bg-accent/5"
                : "border-border bg-secondary/30",
            )}
          >
            <div className="text-[8px] font-semibold text-foreground truncate">{plan.name}</div>
            <div className="text-[9px] font-bold text-foreground">${plan.price}<span className="text-[7px] font-normal text-muted-foreground">/{plan.billingInterval === "yearly" ? "yr" : "mo"}</span></div>
            <div className="space-y-1">
              <div className="h-1 w-full rounded bg-foreground/5" />
              <div className="h-1 w-full rounded bg-foreground/5" />
              <div className="h-1 w-3/4 rounded bg-foreground/5" />
            </div>
            <div
              className={cn(
                "h-4 rounded text-[7px] font-medium flex items-center justify-center",
                i === 1
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {i === 1 ? "Selected" : "Select"}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-border bg-secondary/30 p-2 flex items-center gap-2">
        <div className="w-6 h-4 rounded bg-foreground/10" />
        <div className="h-1.5 w-20 rounded bg-foreground/5" />
      </div>
    </div>
  );
}

function PricingTablePreview({ plans }: { plans: RealPlan[] }) {
  const planList = plans.length
    ? plans.slice(0, 3)
    : [
        { id: "1", name: "Starter", price: 9, billingInterval: "monthly" },
        { id: "2", name: "Pro", price: 29, billingInterval: "monthly" },
        { id: "3", name: "Enterprise", price: 99, billingInterval: "monthly" },
      ];
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="h-2 w-16 rounded bg-foreground/10" />
        <div className="flex gap-1">
          <div className="h-4 w-12 rounded-md bg-accent/15 flex items-center justify-center">
            <span className="text-[7px] font-medium text-accent">Monthly</span>
          </div>
          <div className="h-4 w-12 rounded-md bg-secondary flex items-center justify-center">
            <span className="text-[7px] text-muted-foreground">Annual</span>
          </div>
        </div>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(planList.length, 3)}, 1fr)` }}>
        {planList.map((plan, i) => (
          <div
            key={plan.id}
            className={cn(
              "rounded-md border p-2 space-y-1.5",
              i === 1
                ? "border-accent bg-accent/5"
                : "border-border bg-secondary/30",
            )}
          >
            <div className="text-[8px] font-semibold text-foreground truncate">{plan.name}</div>
            <div className="text-[9px] font-bold text-foreground">${plan.price}<span className="text-[7px] text-muted-foreground">/{plan.billingInterval === "yearly" ? "yr" : "mo"}</span></div>
            <div className="space-y-0.5">
              {[1, 2, 3].map((j) => (
                <div key={j} className="flex items-center gap-0.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/30" />
                  <div className="h-1 flex-1 rounded bg-foreground/5" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UsageDashboardPreview() {
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between">
        <div className="h-2 w-14 rounded bg-foreground/10" />
        <div className="h-4 w-14 rounded-md bg-secondary flex items-center justify-center">
          <span className="text-[7px] text-muted-foreground">This month</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1">
          <div className="h-1.5 w-10 rounded bg-foreground/10" />
          <div className="flex items-end gap-0.5 h-6">
            {[40, 65, 45, 80, 60, 75, 90].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-accent/25"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-md border border-border bg-secondary/30 p-2 space-y-1.5">
          <div className="h-1.5 w-10 rounded bg-foreground/10" />
          <div className="space-y-1">
            {[75, 45, 90].map((w, i) => (
              <div key={i} className="space-y-0.5">
                <div className="h-1 w-8 rounded bg-foreground/8" />
                <div className="h-1.5 rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-accent/40"
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckoutModalPreview({ plans }: { plans: RealPlan[] }) {
  const selectedPlan = plans[1] ?? plans[0];
  const planName = selectedPlan?.name ?? "Pro Plan";
  const planPrice = selectedPlan ? `$${selectedPlan.price}` : "$29";
  const billingLabel = selectedPlan?.billingInterval === "yearly" ? "/yr" : "/mo";
  const token = selectedPlan?.acceptedToken ?? "USDC";
  const steps = ["Wallet", "Account", "Autopay", "Approve", "Subscribe"];
  const activeStep = 3;

  return (
    <div className="p-3">
      <div className="rounded-lg border border-accent/20 bg-card/80 p-2 space-y-2 shadow-sm">
        {/* Modal header */}
        <div className="flex items-center justify-between pb-1.5 border-b border-border">
          <span className="text-[9px] font-semibold text-foreground truncate">Subscribe · {planName}</span>
          <div className="w-3 h-3 rounded-full bg-secondary flex items-center justify-center text-[7px] text-muted-foreground shrink-0">✕</div>
        </div>
        {/* Step progress */}
        <div className="flex items-center gap-0.5">
          {steps.map((_, i) => (
            <React.Fragment key={i}>
              <div className={cn(
                "w-3.5 h-3.5 rounded-full flex items-center justify-center text-[6px] font-bold shrink-0",
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
            <p className="text-[7px] text-muted-foreground">Subscribing to</p>
            <p className="text-[9px] font-semibold text-foreground">{planName}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold text-foreground">{planPrice}<span className="text-[7px] font-normal text-muted-foreground">{billingLabel}</span></p>
            <p className="text-[7px] text-muted-foreground">{token}</p>
          </div>
        </div>
        {/* Wallet + chain */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-success/5 border border-success/20">
          <div className="w-3 h-3 rounded-full bg-success/20 flex items-center justify-center shrink-0">
            <span className="text-[6px] text-success font-bold">✓</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[7px] text-muted-foreground">Wallet</p>
            <p className="text-[7px] font-mono text-foreground">0x4a2f…8c3d</p>
          </div>
          <div className="px-1 py-0.5 rounded bg-accent/10 text-[6px] font-medium text-accent shrink-0">Base</div>
        </div>
        {/* Approve USDC */}
        <div className="flex items-center gap-1.5 p-1.5 rounded-md bg-warning/5 border border-warning/20">
          <div className="w-3 h-3 rounded-full bg-warning/15 flex items-center justify-center shrink-0 animate-pulse">
            <span className="text-[6px] font-bold text-warning">!</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[7px] font-medium text-foreground">Approve {token}</p>
            <p className="text-[6px] text-muted-foreground">Allow charge {planPrice}{billingLabel}</p>
          </div>
        </div>
        {/* CTA */}
        <div className="h-5 rounded-md bg-accent text-[7px] font-semibold flex items-center justify-center text-accent-foreground">
          Approve &amp; Subscribe
        </div>
      </div>
    </div>
  );
}

function BillingHistoryPreview() {
  return (
    <div className="space-y-1.5 p-3">
      <div className="flex items-center justify-between pb-1.5 border-b border-border">
        <div className="h-2 w-16 rounded bg-foreground/10" />
        <div className="h-4 w-12 rounded-md bg-secondary flex items-center justify-center">
          <span className="text-[7px] text-muted-foreground">All time</span>
        </div>
      </div>
      {[
        { label: "Plan upgraded → Pro", tag: "upgrade" },
        { label: "Payment · $29.00 USDC", tag: "payment" },
        { label: "Payment · $9.00 USDC", tag: "payment" },
        { label: "Subscription created", tag: "create" },
      ].map((item, i) => (
        <div key={i} className="flex items-center gap-1.5 py-0.5">
          <div
            className={cn(
              "w-1.5 h-1.5 shrink-0 rounded-full",
              item.tag === "upgrade" ? "bg-accent" : item.tag === "create" ? "bg-success" : "bg-muted-foreground/40",
            )}
          />
          <span className="text-[8px] text-foreground flex-1 truncate">{item.label}</span>
          <span className="text-[7px] text-muted-foreground shrink-0">Mar {4 - i}</span>
        </div>
      ))}
    </div>
  );
}

function buildPreviewMap(plans: RealPlan[], flags: RealFlag[]) {
  return {
    "customer-portal": CustomerPortalPreview,
    checkout: () => <CheckoutPreview plans={plans} />,
    "pricing-table": () => <PricingTablePreview plans={plans} />,
    "usage-dashboard": UsageDashboardPreview,
    "checkout-modal": () => <CheckoutModalPreview plans={plans} />,
    "billing-history": BillingHistoryPreview,
  } as Record<string, React.FC>;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  Portal: Layers,
  Checkout: CreditCard,
  Billing: ReceiptText,
  Usage: BarChart3,
};

// ============================================================
// Main Components Section
// ============================================================

export function ComponentsSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [customComponents, setCustomComponents] = useState<ComponentConfig[]>(
    [],
  );
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentConfig | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [realPlans, setRealPlans] = useState<RealPlan[]>([]);
  const [realFlags, setRealFlags] = useState<RealFlag[]>([]);

  // Fetch real plans + flags for live previews
  useEffect(() => {
    fetch("/api/catalog/plans?status=PUBLISHED")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const plans: RealPlan[] = (
          Array.isArray(data) ? data : data.plans ?? []
        ).map(
          (p: Record<string, unknown>) => ({
            id: String(p.id ?? ""),
            name: String(p.name ?? ""),
            price: Number(p.price ?? 0),
            billingInterval: String(p.billingInterval ?? "monthly"),
            tier: String(p.tier ?? ""),
            description: String(p.description ?? ""),
            acceptedToken: String(p.acceptedToken ?? "USDC"),
          }),
        );
        if (plans.length > 0) setRealPlans(plans);
      })
      .catch(() => {});

    fetch("/api/v1/feature-flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const flags: RealFlag[] = (
          Array.isArray(data) ? data : data.data ?? []
        ).map(
          (f: Record<string, unknown>) => ({
            featureKey: String(f.featureKey ?? ""),
            name: String(f.name ?? ""),
            featureType: String(f.featureType ?? "boolean"),
            defaultValue: Boolean(f.defaultValue ?? false),
          }),
        );
        if (flags.length > 0) setRealFlags(flags);
      })
      .catch(() => {});
  }, []);

  // Load custom components from server on mount
  useEffect(() => {
    fetch("/api/v1/components")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.data) return;
        const loaded: ComponentConfig[] = (data.data as Array<{
          id: string;
          name: string;
          elements: unknown;
          design: unknown;
          createdAt: string;
          updatedAt: string;
        }>).map((c) => ({
          id: c.id,
          name: c.name,
          description: "",
          type: "custom" as const,
          category: "Custom",
          elements: Array.isArray(c.elements) ? (c.elements as ComponentConfig["elements"]) : [],
          styling: {
            columns: 2,
            sections: "merged" as const,
            primaryColor: "#6366f1",
            secondaryColor: "#e0e7ff",
            cardStyle: {
              backgroundColor: "#FFFFFF",
              borderRadius: "10px",
              cardShadow: true,
              cardPadding: "45px",
            },
            typography: { fontFamily: "Inter", fontSize: "14px" },
          },
          template: "blank",
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        }));
        setCustomComponents(loaded);
      })
      .catch(() => {});
  }, []);

  const allComponents = [...DEFAULT_SDK_COMPONENTS, ...customComponents];

  const filteredComponents = allComponents.filter(
    (component) =>
      component.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      component.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      component.category?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const sdkComponents = filteredComponents.filter((c) => c.type === "sdk");
  const userComponents = filteredComponents.filter((c) => c.type === "custom");

  const handleOpenComponent = (component: ComponentConfig) => {
    setSelectedComponent(component);
    setEditorOpen(true);
  };

  const handleCreateNew = () => {
    const newComponent: ComponentConfig = {
      id: `custom-${Date.now()}`,
      name: "New Component",
      description: "Describe your component",
      type: "custom",
      category: "Custom",
      elements: [],
      styling: {
        columns: 2,
        sections: "merged",
        primaryColor: "#6366f1",
        secondaryColor: "#e0e7ff",
        cardStyle: {
          backgroundColor: "#FFFFFF",
          borderRadius: "10px",
          cardShadow: true,
          cardPadding: "45px",
        },
        typography: {
          fontFamily: "Inter",
          fontSize: "14px",
        },
      },
      template: "blank",
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

      // Persist to API
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
            // Use the server-assigned ID
            const saved: ComponentConfig = { ...component, id: data.data.id };
            setCustomComponents((prev) => [...prev, saved]);
          } else {
            setCustomComponents((prev) => [...prev, component]);
          }
        } else {
          await fetch(`/api/v1/components/${component.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: component.name,
              elements: component.elements,
              design: component.styling,
            }),
          });
          const newComponents = [...customComponents];
          newComponents[existingIndex] = component;
          setCustomComponents(newComponents);
        }
      } catch {
        // Optimistic fallback — update local state even if API fails
        if (isNew) {
          setCustomComponents((prev) => [...prev, component]);
        } else {
          const newComponents = [...customComponents];
          newComponents[existingIndex] = component;
          setCustomComponents(newComponents);
        }
      }
    }
    setEditorOpen(false);
    setSelectedComponent(null);
  };

  const handleDeleteComponent = async (id: string) => {
    setCustomComponents(customComponents.filter((c) => c.id !== id));
    try {
      await fetch(`/api/v1/components/${id}`, { method: "DELETE" });
    } catch {
      // Ignore — already removed from local state
    }
  };

  const handleDuplicateComponent = (component: ComponentConfig) => {
    const duplicated: ComponentConfig = {
      ...component,
      id: `custom-${Date.now()}`,
      name: `${component.name} (Copy)`,
      type: "custom",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setCustomComponents([...customComponents, duplicated]);
  };

  const realData: RealData = { plans: realPlans, flags: realFlags };
  const PREVIEW_MAP = buildPreviewMap(realPlans, realFlags);

  if (editorOpen && selectedComponent) {
    return (
      <ComponentEditor
        component={selectedComponent}
        onClose={() => {
          setEditorOpen(false);
          setSelectedComponent(null);
        }}
        onSave={handleSaveComponent}
        realData={realData}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header — matches Plans section style */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Drop-in billing components designed to convert, expand, and retain
            customers
          </p>
        </div>
        <Button className="flex items-center gap-2" onClick={handleCreateNew}>
          <Plus className="w-4 h-4" />
          Create Component
        </Button>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search components…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-64 h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>
      </div>

      {/* Pre-built Components Grid */}
      {sdkComponents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Pre-built Components
            </h2>
            <span className="text-xs text-muted-foreground">
              {sdkComponents.length} available
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {sdkComponents.map((component, index) => {
              const Preview = PREVIEW_MAP[component.id];
              const CategoryIcon =
                CATEGORY_ICONS[component.category || ""] || Layers;

              return (
                <div
                  key={component.id}
                  className="group bg-card border border-border rounded-xl overflow-hidden hover:border-accent/40 hover:shadow-md transition-all duration-200 cursor-pointer animate-in fade-in slide-in-from-left-2"
                  style={{
                    animationDelay: `${index * 60}ms`,
                    animationFillMode: "both",
                  }}
                  onClick={() => handleOpenComponent(component)}
                >
                  {/* Preview Area */}
                  <div className="border-b border-border bg-secondary/30 h-40 overflow-hidden relative">
                    {Preview && <Preview />}
                    <div className="absolute inset-0 bg-gradient-to-t from-card/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>

                  {/* Info */}
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground truncate">
                            {component.name}
                          </h3>
                          <Badge
                            variant="secondary"
                            className="text-[10px] shrink-0 bg-accent/10 text-accent border-accent/20"
                          >
                            SDK
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {component.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {component.elements.length} elements
                        </span>
                        <span className="flex items-center gap-1">
                          <CategoryIcon className="w-3 h-3" />
                          {component.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateComponent(component);
                          }}
                        >
                          <Copy className="w-3 h-3" />
                          Customize
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenComponent(component);
                          }}
                        >
                          <Code2 className="w-3 h-3" />
                          Get Code
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom Components — same card grid as pre-built */}
      {userComponents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Custom Components
            </h2>
            <span className="text-xs text-muted-foreground">
              {userComponents.length} component{userComponents.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {userComponents.map((component, index) => (
              <div
                key={component.id}
                className="group bg-card border border-border rounded-xl overflow-hidden hover:border-accent/40 hover:shadow-md transition-all duration-200 cursor-pointer animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${index * 60}ms`, animationFillMode: "both" }}
                onClick={() => handleOpenComponent(component)}
              >
                {/* Preview area — custom element wireframe */}
                <div className="border-b border-border bg-secondary/30 h-40 overflow-hidden relative flex items-center justify-center">
                  <div className="w-full px-4 py-2 space-y-2 pointer-events-none">
                    {component.elements.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-28 gap-2 opacity-50">
                        <Layers className="w-6 h-6 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">No elements</span>
                      </div>
                    ) : (
                      component.elements.slice(0, 3).map((el, i) => (
                        <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-background/60 border border-border/60">
                          <div className="w-4 h-4 rounded flex items-center justify-center bg-accent/10 shrink-0">
                            <Layers className="w-2.5 h-2.5 text-accent" />
                          </div>
                          <span className="text-xs font-medium text-foreground">{el.label}</span>
                        </div>
                      ))
                    )}
                    {component.elements.length > 3 && (
                      <p className="text-[10px] text-muted-foreground text-center">+{component.elements.length - 3} more</p>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-card/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Info */}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground truncate">{component.name}</h3>
                        <Badge variant="secondary" className="text-[10px] shrink-0 bg-secondary text-muted-foreground border-border">
                          Custom
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {component.description || `${component.elements.length} element${component.elements.length !== 1 ? "s" : ""} · Updated ${component.updatedAt.toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Layers className="w-3 h-3" />
                        {component.elements.length} elements
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={(e) => { e.stopPropagation(); handleDuplicateComponent(component); }}
                      >
                        <Copy className="w-3 h-3" />
                        Duplicate
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 hover:bg-destructive/10"
                        onClick={(e) => { e.stopPropagation(); handleDeleteComponent(component.id); }}
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state — only when no search and no custom components */}
      {!searchQuery && customComponents.length === 0 && (
        <div className="bg-card border border-dashed border-border rounded-xl">
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <Plus className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">
              Build your own component
            </h3>
            <p className="text-xs text-muted-foreground max-w-[320px] mb-4">
              Use the drag-and-drop builder to compose billing elements into a
              custom component that matches your brand
            </p>
            <Button
              onClick={handleCreateNew}
              className="flex items-center gap-2"
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
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-3">
              <Search className="w-6 h-6 text-muted-foreground" />
            </div>
            <h3 className="text-sm font-medium text-foreground mb-1">
              No components found
            </h3>
            <p className="text-xs text-muted-foreground max-w-[320px] mb-4">
              Try adjusting your search or create a new custom component
            </p>
            <Button
              onClick={handleCreateNew}
              className="flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Component
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
