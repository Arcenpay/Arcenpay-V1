"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import {
  ComponentEditor,
  type ComponentConfig,
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
      primaryColor: "#000000",
      secondaryColor: "#194BFB",
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
      primaryColor: "#000000",
      secondaryColor: "#194BFB",
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
      primaryColor: "#000000",
      secondaryColor: "#194BFB",
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
      primaryColor: "#000000",
      secondaryColor: "#194BFB",
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

function CheckoutPreview() {
  return (
    <div className="space-y-2 p-3">
      <div className="h-2 w-20 rounded bg-foreground/10" />
      <div className="flex gap-2">
        {[false, true, false].map((active, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-md border p-2 space-y-1.5",
              active
                ? "border-accent bg-accent/5"
                : "border-border bg-secondary/30",
            )}
          >
            <div className="h-1.5 w-8 rounded bg-foreground/10" />
            <div className="h-2.5 w-10 rounded bg-foreground/15" />
            <div className="space-y-1">
              <div className="h-1 w-full rounded bg-foreground/5" />
              <div className="h-1 w-full rounded bg-foreground/5" />
              <div className="h-1 w-3/4 rounded bg-foreground/5" />
            </div>
            <div
              className={cn(
                "h-4 rounded text-[7px] font-medium flex items-center justify-center",
                active
                  ? "bg-accent text-accent-foreground"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {active ? "Selected" : "Select"}
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

function PricingTablePreview() {
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
      <div className="grid grid-cols-3 gap-1.5">
        {["Starter", "Pro", "Enterprise"].map((name, i) => (
          <div
            key={i}
            className={cn(
              "rounded-md border p-2 space-y-1.5",
              i === 1
                ? "border-accent bg-accent/5"
                : "border-border bg-secondary/30",
            )}
          >
            <div className="h-1.5 w-10 rounded bg-foreground/10" />
            <div className="h-2.5 w-8 rounded bg-foreground/15" />
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

const PREVIEW_MAP: Record<string, React.FC> = {
  "customer-portal": CustomerPortalPreview,
  checkout: CheckoutPreview,
  "pricing-table": PricingTablePreview,
  "usage-dashboard": UsageDashboardPreview,
};

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
        primaryColor: "#000000",
        secondaryColor: "#194BFB",
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

  const handleSaveComponent = (component: ComponentConfig) => {
    if (component.type === "custom") {
      const existingIndex = customComponents.findIndex(
        (c) => c.id === component.id,
      );
      if (existingIndex >= 0) {
        const newComponents = [...customComponents];
        newComponents[existingIndex] = component;
        setCustomComponents(newComponents);
      } else {
        setCustomComponents([...customComponents, component]);
      }
    }
    setEditorOpen(false);
    setSelectedComponent(null);
  };

  const handleDeleteComponent = (id: string) => {
    setCustomComponents(customComponents.filter((c) => c.id !== id));
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

      {/* Custom Components */}
      {userComponents.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Custom Components
          </h2>

          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Name
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Elements
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Template
                  </th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Updated
                  </th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {userComponents.map((component, index) => (
                  <tr
                    key={component.id}
                    className="border-b border-border last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer animate-in fade-in slide-in-from-left-2"
                    style={{
                      animationDelay: `${index * 40}ms`,
                      animationFillMode: "both",
                    }}
                    onClick={() => handleOpenComponent(component)}
                  >
                    <td className="py-3 px-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {component.name}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {component.description}
                        </p>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {component.elements.length} elements
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="secondary" className="text-xs">
                        {component.template}
                      </Badge>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-muted-foreground">
                        {component.updatedAt.toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDuplicateComponent(component);
                          }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteComponent(component.id);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
