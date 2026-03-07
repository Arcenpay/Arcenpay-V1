"use client";

import React, { useState } from "react";
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
    ],
  },
];

const ALL_ELEMENTS = ELEMENT_LIBRARY.flatMap((cat) => cat.elements);

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

function ElementPreview({ type }: { type: string }) {
  switch (type) {
    case "pricing-table":
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {["Starter", "Pro", "Enterprise"].map((name, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-3 space-y-2",
                  i === 1
                    ? "border-accent bg-accent/5"
                    : "border-border bg-secondary/20",
                )}
              >
                <p className="text-[10px] font-semibold text-foreground">
                  {name}
                </p>
                <p className="text-sm font-bold text-foreground">
                  ${[9, 29, 99][i]}
                  <span className="text-[9px] font-normal text-muted-foreground">
                    /mo
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

    case "plan-manager":
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold text-foreground">
                Pro Plan
              </p>
              <p className="text-[9px] text-muted-foreground">$29/month</p>
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

    case "included-features":
      return (
        <div className="space-y-1.5">
          {[
            { name: "API Access", on: true },
            { name: "Webhooks", on: true },
            { name: "Custom Domain", on: false },
            { name: "SSO", on: false },
          ].map((f, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-[9px] text-foreground">{f.name}</span>
              <div
                className={cn(
                  "w-5 h-3 rounded-full relative",
                  f.on ? "bg-accent" : "bg-secondary",
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-2 h-2 rounded-full bg-white",
                    f.on ? "right-0.5" : "left-0.5",
                  )}
                />
              </div>
            </div>
          ))}
        </div>
      );

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
  const [activeTab, setActiveTab] = useState<"design" | "preview" | "code">(
    "design",
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
    elements.forEach((el) => {
      const componentName = el.type
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("");
      imports.add(componentName);
    });

    return `import { ${Array.from(imports).join(", ")} } from '@meap/sdk-react';
import { MEAPProvider } from '@meap/sdk-react';

export function ${config.name.replace(/\s+/g, "")}() {
  return (
    <MEAPProvider>
      <div className="container mx-auto p-6 space-y-6">
${elements
  .map((el) => {
    const componentName = el.type
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");
    return `        <${componentName} />`;
  })
  .join("\n")}
      </div>
    </MEAPProvider>
  );
}`;
  };

  const generateInstallCode = () => {
    return `<!-- Add to your HTML -->
<div id="meap-component-root"></div>

<!-- Install via CDN -->
<script src="https://cdn.meap.io/sdk-react/latest.min.js"></script>
<script>
  MeapSDK.render('${config.id}', {
    apiKey: 'YOUR_API_KEY',
    container: '#meap-component-root',
    theme: {
      primaryColor: '${config.styling.primaryColor}',
      secondaryColor: '${config.styling.secondaryColor}'
    }
  });
</script>

<!-- OR via NPM -->
npm install @meap/sdk-react @meap/core wagmi viem`;
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

  const tabs = [
    { id: "design" as const, label: "Design", icon: Palette },
    { id: "preview" as const, label: "Preview", icon: Eye },
    { id: "code" as const, label: "Installation", icon: Code2 },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background">
      {/* Header — matched to dashboard header style */}
      <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-background/80 backdrop-blur-sm">
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
            <h2 className="text-sm font-semibold text-foreground">
              {config.name}
            </h2>
            <p className="text-xs text-muted-foreground">
              {config.type === "sdk" ? "SDK Component" : "Custom Component"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Tab pills — matching dashboard filter style */}
          <div className="flex items-center gap-1 bg-secondary/50 rounded-lg p-0.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                    activeTab === tab.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
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
            className="gap-2 text-xs bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex h-[calc(100vh-56px)]">
        {/* Left Sidebar — Configuration */}
        {activeTab === "design" && (
          <div className="w-72 border-r border-border overflow-y-auto bg-background">
            <div className="p-4 space-y-5">
              {/* Component Settings */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Component Settings
                </p>
                <div className="space-y-3">
                  <div>
                    <Label
                      htmlFor="name"
                      className="text-xs text-muted-foreground mb-1.5 block"
                    >
                      Name
                    </Label>
                    <Input
                      id="name"
                      value={config.name}
                      onChange={(e) =>
                        setConfig({ ...config, name: e.target.value })
                      }
                      className="h-9"
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="desc"
                      className="text-xs text-muted-foreground mb-1.5 block"
                    >
                      Description
                    </Label>
                    <Textarea
                      id="desc"
                      value={config.description}
                      onChange={(e) =>
                        setConfig({ ...config, description: e.target.value })
                      }
                      className="h-16 resize-none"
                    />
                  </div>
                </div>
              </div>

              {/* Template Selection (custom only) */}
              {config.type === "custom" && (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Template
                  </p>
                  <Select value={config.template} onValueChange={applyTemplate}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select template" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATES.map((template) => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    {
                      TEMPLATES.find((t) => t.id === config.template)
                        ?.description
                    }
                  </p>
                </div>
              )}

              {/* Styling */}
              <div className="pt-4 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Styling
                </p>
                <div className="space-y-3">
                  {/* Columns */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Columns
                    </Label>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4].map((num) => (
                        <button
                          key={num}
                          onClick={() =>
                            setConfig({
                              ...config,
                              styling: { ...config.styling, columns: num },
                            })
                          }
                          className={cn(
                            "flex-1 h-8 rounded-md text-xs font-medium transition-all duration-200",
                            config.styling.columns === num
                              ? "bg-accent text-accent-foreground"
                              : "bg-secondary text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {num}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sections mode */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Card Layout
                    </Label>
                    <div className="flex gap-1.5">
                      {(["merged", "separate"] as const).map((mode) => (
                        <button
                          key={mode}
                          onClick={() =>
                            setConfig({
                              ...config,
                              styling: { ...config.styling, sections: mode },
                            })
                          }
                          className={cn(
                            "flex-1 h-8 rounded-md text-xs font-medium capitalize transition-all duration-200",
                            config.styling.sections === mode
                              ? "bg-accent text-accent-foreground"
                              : "bg-secondary text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Colors */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Primary Color
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={config.styling.primaryColor}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            styling: {
                              ...config.styling,
                              primaryColor: e.target.value,
                            },
                          })
                        }
                        className="w-10 h-9 p-1 cursor-pointer"
                      />
                      <Input
                        value={config.styling.primaryColor}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            styling: {
                              ...config.styling,
                              primaryColor: e.target.value,
                            },
                          })
                        }
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Secondary Color
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        type="color"
                        value={config.styling.secondaryColor}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            styling: {
                              ...config.styling,
                              secondaryColor: e.target.value,
                            },
                          })
                        }
                        className="w-10 h-9 p-1 cursor-pointer"
                      />
                      <Input
                        value={config.styling.secondaryColor}
                        onChange={(e) =>
                          setConfig({
                            ...config,
                            styling: {
                              ...config.styling,
                              secondaryColor: e.target.value,
                            },
                          })
                        }
                        className="h-9 font-mono text-xs"
                      />
                    </div>
                  </div>

                  {/* Border Radius */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Border Radius
                    </Label>
                    <Input
                      value={config.styling.cardStyle.borderRadius}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          styling: {
                            ...config.styling,
                            cardStyle: {
                              ...config.styling.cardStyle,
                              borderRadius: e.target.value,
                            },
                          },
                        })
                      }
                      placeholder="10px"
                      className="h-9"
                    />
                  </div>

                  {/* Font */}
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Font Family
                    </Label>
                    <Select
                      value={config.styling.typography.fontFamily}
                      onValueChange={(v) =>
                        setConfig({
                          ...config,
                          styling: {
                            ...config.styling,
                            typography: {
                              ...config.styling.typography,
                              fontFamily: v,
                            },
                          },
                        })
                      }
                    >
                      <SelectTrigger className="h-9">
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
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Center — Canvas / Preview / Code */}
        <div className="flex-1 overflow-y-auto bg-secondary/5">
          {activeTab === "design" && (
            <div className="p-6">
              <div className="max-w-5xl mx-auto">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className={cn(
                    "min-h-[500px] border-2 border-dashed border-border rounded-xl p-6 bg-background transition-colors",
                    draggedElement && "border-accent/50 bg-accent/5",
                    elements.length === 0 && "flex items-center justify-center",
                  )}
                >
                  {elements.length === 0 ? (
                    <div className="text-center">
                      <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mx-auto mb-3">
                        <LayoutTemplate className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        Drop elements here
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-[300px] mx-auto">
                        Drag components from the Element Library or click the +
                        button to add billing elements
                      </p>
                    </div>
                  ) : (
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
                        return (
                          <div
                            key={element.id}
                            className={cn(
                              "group relative rounded-xl border transition-all",
                              selectedElement === element.id
                                ? "border-accent shadow-sm"
                                : "border-border hover:border-accent/40",
                            )}
                            onClick={() => setSelectedElement(element.id)}
                          >
                            {/* Element header */}
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-secondary/30 rounded-t-xl">
                              <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-move opacity-0 group-hover:opacity-100 transition-opacity" />
                              <div className="w-5 h-5 rounded flex items-center justify-center bg-accent/10">
                                <Icon className="w-3 h-3 text-accent" />
                              </div>
                              <span className="text-xs font-medium text-foreground flex-1">
                                {element.label}
                              </span>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveElement(index, "up");
                                  }}
                                  disabled={index === 0}
                                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
                                >
                                  <ChevronUp className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    moveElement(index, "down");
                                  }}
                                  disabled={index === elements.length - 1}
                                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-secondary disabled:opacity-30"
                                >
                                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeElement(element.id);
                                  }}
                                  className="h-5 w-5 flex items-center justify-center rounded hover:bg-destructive/10"
                                >
                                  <Trash2 className="w-3 h-3 text-destructive" />
                                </button>
                              </div>
                            </div>
                            {/* Element preview */}
                            <div className="p-3">
                              <ElementPreview type={element.type} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "preview" && (
            <div className="p-6">
              <div className="max-w-5xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">
                      {config.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {config.description}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className="text-[10px] bg-accent/10 text-accent"
                  >
                    Live Preview
                  </Badge>
                </div>

                {elements.length === 0 ? (
                  <div className="bg-card border border-border rounded-xl">
                    <div className="flex flex-col items-center justify-center py-16">
                      <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center mb-3">
                        <Eye className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Add elements to see preview
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    className="grid gap-4"
                    style={{
                      gridTemplateColumns: `repeat(${config.styling.columns}, 1fr)`,
                    }}
                  >
                    {elements.map((element) => {
                      const Icon = element.icon;
                      return (
                        <div
                          key={element.id}
                          className="bg-card border border-border overflow-hidden"
                          style={{
                            borderRadius: config.styling.cardStyle.borderRadius,
                            boxShadow: config.styling.cardStyle.cardShadow
                              ? "0 1px 3px 0 rgb(0 0 0 / 0.1)"
                              : "none",
                          }}
                        >
                          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/20">
                            <div className="w-6 h-6 rounded flex items-center justify-center bg-accent/10">
                              <Icon className="w-3.5 h-3.5 text-accent" />
                            </div>
                            <span className="text-xs font-semibold text-foreground">
                              {element.label}
                            </span>
                          </div>
                          <div className="p-4">
                            <ElementPreview type={element.type} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === "code" && (
            <div className="p-6">
              <div className="max-w-3xl mx-auto space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Installation Code
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Use this to embed this component in your app
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

                {/* CDN */}
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-secondary/30">
                    <span className="text-xs font-semibold text-foreground">
                      HTML / JavaScript (CDN)
                    </span>
                  </div>
                  <pre className="p-4 overflow-x-auto text-xs font-mono text-foreground/80">
                    <code>{generateInstallCode()}</code>
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
                        npm install @meap/sdk-react @meap/core wagmi viem
                      </pre>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground mb-2">
                        2. Configure Provider
                      </p>
                      <pre className="bg-secondary/30 p-3 rounded-lg text-xs font-mono border border-border overflow-x-auto">
                        <code>{`import { MEAPProvider } from '@meap/sdk-react';
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

        {/* Right Sidebar — Element Library */}
        {activeTab === "design" && config.type === "custom" && (
          <div className="w-72 border-l border-border overflow-y-auto bg-background">
            <div className="p-4">
              <div className="mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Element Library
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Drag or click to add billing elements
                </p>
              </div>

              <div className="space-y-4">
                {ELEMENT_LIBRARY.map((category) => (
                  <div key={category.category}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-medium">
                      {category.category}
                    </p>
                    <div className="space-y-1.5">
                      {category.elements.map((element) => {
                        const Icon = element.icon;
                        const isAdded = elements.some(
                          (el) => el.type === element.type,
                        );
                        return (
                          <div
                            key={element.type}
                            draggable
                            onDragStart={() => handleDragStart(element)}
                            onClick={() => !isAdded && addElement(element)}
                            className={cn(
                              "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all cursor-pointer",
                              isAdded
                                ? "border-accent/30 bg-accent/5 opacity-60"
                                : "border-border bg-card hover:border-accent/40 hover:bg-secondary/30 active:cursor-grabbing",
                            )}
                          >
                            <div
                              className={cn(
                                "w-6 h-6 rounded flex items-center justify-center shrink-0",
                                isAdded ? "bg-accent/15" : "bg-secondary",
                              )}
                            >
                              <Icon
                                className={cn(
                                  "w-3.5 h-3.5",
                                  isAdded
                                    ? "text-accent"
                                    : "text-muted-foreground",
                                )}
                              />
                            </div>
                            <span
                              className={cn(
                                "text-xs font-medium",
                                isAdded ? "text-accent" : "text-foreground",
                              )}
                            >
                              {element.label}
                            </span>
                            {isAdded && (
                              <Check className="w-3 h-3 text-accent ml-auto" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Right Sidebar — Element Library (read-only for SDK) */}
        {activeTab === "design" && config.type === "sdk" && (
          <div className="w-72 border-l border-border overflow-y-auto bg-background">
            <div className="p-4">
              <div className="mb-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Component Elements
                </p>
                <p className="text-[10px] text-muted-foreground">
                  SDK components have a fixed element set. Customize to modify.
                </p>
              </div>

              <div className="space-y-1.5">
                {elements.map((element) => {
                  const Icon = element.icon;
                  return (
                    <div
                      key={element.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card"
                    >
                      <div className="w-6 h-6 rounded flex items-center justify-center bg-accent/10">
                        <Icon className="w-3.5 h-3.5 text-accent" />
                      </div>
                      <span className="text-xs font-medium text-foreground">
                        {element.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 p-3 rounded-lg bg-secondary/30 border border-border">
                <p className="text-[10px] text-muted-foreground">
                  Want to add or remove elements? Click{" "}
                  <span className="font-medium text-foreground">Customize</span>{" "}
                  to create an editable copy of this component.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
