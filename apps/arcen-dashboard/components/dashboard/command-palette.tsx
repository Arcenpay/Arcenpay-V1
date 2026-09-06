"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  LayoutDashboard,
  Layers,
  Package,
  Coins,
  SlidersHorizontal,
  Building2,
  Users,
  Flag,
  Zap,
  Activity,
  LayoutTemplate,
  Webhook,
  Bot,
  ReceiptText,
  CreditCard,
  ClipboardList,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
} from "lucide-react";

type SearchItem = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  href: string;
  group: string;
  keywords?: string[];
};

const searchItems: SearchItem[] = [
  // Overview
  { id: "overview", label: "Overview", icon: LayoutDashboard, href: "/", group: "Navigation", keywords: ["home", "dashboard", "main"] },

  // Catalog
  { id: "catalog-plans", label: "Plans", icon: Layers, href: "/?section=catalog-plans", group: "Catalog", keywords: ["subscription", "plan", "catalog"] },
  { id: "catalog-addons", label: "Add-Ons", icon: Package, href: "/?section=catalog-addons", group: "Catalog", keywords: ["addon", "product", "extra"] },
  { id: "catalog-credits", label: "Credits", icon: Coins, href: "/?section=catalog-credits", group: "Catalog", keywords: ["credit", "pack", "token"] },
  { id: "catalog-config", label: "Configuration", icon: SlidersHorizontal, href: "/?section=catalog-config", group: "Catalog", keywords: ["config", "settings", "environment"] },

  // Manage
  { id: "companies", label: "Companies", icon: Building2, href: "/?section=companies", group: "Manage", keywords: ["company", "customer", "client"] },
  { id: "subscribers", label: "Users", icon: Users, href: "/?section=subscribers", group: "Manage", keywords: ["user", "subscriber", "customer"] },
  { id: "features", label: "Entitlements", icon: Flag, href: "/?section=features", group: "Manage", keywords: ["feature", "entitlement", "tier"] },
  { id: "feature-flags", label: "Feature Flags", icon: Zap, href: "/?section=feature-flags", group: "Manage", keywords: ["flag", "toggle", "feature flag"] },

  // Connections
  { id: "events-stream", label: "Events", icon: Activity, href: "/?section=events-stream", group: "Connections", keywords: ["event", "stream", "track"] },
  { id: "components", label: "Components", icon: LayoutTemplate, href: "/?section=components", group: "Connections", keywords: ["component", "ui", "embed"] },
  { id: "webhooks", label: "Webhooks", icon: Webhook, href: "/?section=webhooks", group: "Connections", keywords: ["webhook", "endpoint", "callback"] },

  // Agent
  { id: "agent", label: "Arcen Agent", icon: Bot, href: "/?section=agent", group: "Arcen Agent", keywords: ["agent", "arcen", "ai", "sdk"] },

  // Admin
  { id: "invoices", label: "Invoices", icon: ReceiptText, href: "/?section=invoices", group: "Admin", keywords: ["invoice", "billing", "payment"] },
  { id: "payments", label: "Payments", icon: CreditCard, href: "/?section=payments", group: "Admin", keywords: ["payment", "checkout", "link"] },
  { id: "billing", label: "Billing & Plan", icon: CreditCard, href: "/?section=billing", group: "Admin", keywords: ["billing", "tier", "plan"] },
  { id: "audit-log", label: "Audit Log", icon: ClipboardList, href: "/?section=audit-log", group: "Admin", keywords: ["audit", "log", "history"] },
  { id: "settings", label: "Settings", icon: Settings, href: "/?section=settings", group: "Admin", keywords: ["setting", "config", "profile"] },
];

const quickActions: SearchItem[] = [
  { id: "create-plan", label: "Create Plan", icon: Plus, href: "/?section=catalog-plans", group: "Quick Actions", keywords: ["new plan", "create"] },
  { id: "create-company", label: "Create Company", icon: Plus, href: "/?section=companies", group: "Quick Actions", keywords: ["new company", "add customer"] },
  { id: "create-invoice", label: "Create Invoice", icon: Plus, href: "/?section=invoices", group: "Quick Actions", keywords: ["new invoice", "bill"] },
  { id: "open-docs", label: "Open Documentation", icon: ArrowUpRight, href: "https://docs.arcenpay.xyz", group: "Quick Actions", keywords: ["docs", "help", "guide"] },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  // Keyboard shortcut: Cmd/Ctrl + K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [onOpenChange]);

  const allItems = [...searchItems, ...quickActions];

  const handleSelect = (item: SearchItem) => {
    if (item.href.startsWith("http")) {
      window.open(item.href, "_blank");
    } else {
      router.push(item.href, { scroll: false });
    }
    onOpenChange(false);
  };

  const groups = Array.from(new Set(allItems.map((item) => item.group)));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search pages, sections, and actions..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => {
          const items = allItems.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <React.Fragment key={group}>
              <CommandGroup heading={group}>
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.id}
                      value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                      onSelect={() => handleSelect(item)}
                      onClick={() => handleSelect(item)}
                      className="cursor-pointer"
                    >
                      <span className="mr-2 shrink-0">
                        <Icon className="h-4 w-4" strokeWidth={1.5} />
                      </span>
                      <span className="flex-1">{item.label}</span>
                      {item.href.startsWith("http") && (
                        <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
            </React.Fragment>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
