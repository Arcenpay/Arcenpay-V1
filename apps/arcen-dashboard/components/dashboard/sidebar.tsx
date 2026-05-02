"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { useAccount } from "wagmi";
import {
  LayoutDashboard,
  Layers,
  Users,
  ReceiptText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Hexagon,
  Flag,
  Building2,
  ClipboardList,
  LayoutTemplate,
  Package,
  Coins,
  SlidersHorizontal,
  CreditCard,
  Activity,
  Zap,
  Bot,
  Webhook,
  BookOpen,
  ArrowUpRight,
} from "lucide-react";
import { useEnvironment } from "@/contexts/environment-context";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { DASHBOARD_DOCS_URL } from "@/lib/docs-url";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

type NavItem = { id: Section; label: string; icon: React.ElementType };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "",
    items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Catalog",
    items: [
      { id: "catalog-plans", label: "Plans", icon: Layers },
      { id: "catalog-addons", label: "Add-Ons", icon: Package },
      { id: "catalog-credits", label: "Credits", icon: Coins },
      { id: "catalog-config", label: "Configuration", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Manage",
    items: [
      { id: "companies", label: "Companies", icon: Building2 },
      { id: "subscribers", label: "Users", icon: Users },
      { id: "features", label: "Features", icon: Flag },
      { id: "feature-flags", label: "Flags", icon: Zap },
    ],
  },
  {
    label: "Connections",
    items: [
      { id: "events-stream", label: "Events", icon: Activity },
      { id: "components", label: "Components", icon: LayoutTemplate },
      { id: "webhooks", label: "Webhooks", icon: Webhook },
    ],
  },
  {
    label: "Agent",
    items: [{ id: "agent", label: "Agent", icon: Bot }],
  },
  {
    label: "Admin",
    items: [
      { id: "invoices", label: "Invoices", icon: ReceiptText },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "billing", label: "Billing & Plan", icon: CreditCard },
      { id: "audit-log", label: "Audit Log", icon: ClipboardList },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const { address, isConnected } = useAccount();
  const { envMode } = useEnvironment();
  const { data: sessionData } = useDashboardSession();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const teamName = sessionData?.currentTeam?.name ?? null;

  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;

  const networkLabel = envMode ? "Base Sepolia" : "Base Sepolia";

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col",
        collapsed ? "w-[64px]" : "w-[220px]",
      )}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-3 border-b border-sidebar-border shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-gradient-to-br from-accent to-chart-1">
            <Hexagon className="w-3.5 h-3.5 text-accent-foreground" />
          </div>
          <span
            className={cn(
              "font-semibold text-sm text-sidebar-foreground whitespace-nowrap transition-all duration-300",
              collapsed
                ? "opacity-0 w-0 overflow-hidden"
                : "opacity-100 w-auto",
            )}
          >
            ArcenPay
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-3 overflow-y-auto overflow-x-hidden">
        {navGroups.map((group, gi) => (
          <div key={gi} className={gi > 0 ? "mt-4" : ""}>
            {/* Group label — visible when expanded */}
            {group.label && (
              <p
                className={cn(
                  "px-2 mb-1 text-[10px] font-semibold uppercase tracking-widest select-none transition-all duration-300",
                  collapsed
                    ? "opacity-0 h-0 overflow-hidden mb-0"
                    : "opacity-100 text-muted-foreground/60",
                )}
              >
                {group.label}
              </p>
            )}
            {/* Divider in collapsed state (only for labelled groups) */}
            {group.label && collapsed && (
              <div className="mx-2 h-px bg-sidebar-border mb-2" />
            )}

            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => onSectionChange(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150 relative",
                      isActive
                        ? "bg-sidebar-accent text-sidebar-foreground"
                        : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                    )}
                  >
                    {/* Active pill */}
                    <span
                      className={cn(
                        "absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r-full bg-accent transition-all duration-200",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <Icon
                      className={cn(
                        "w-4 h-4 shrink-0",
                        isActive ? "text-accent" : "",
                      )}
                    />
                    <span
                      className={cn(
                        "whitespace-nowrap text-xs transition-all duration-300",
                        collapsed
                          ? "opacity-0 w-0 overflow-hidden"
                          : "opacity-100",
                      )}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Team + Wallet status */}
      <div
        className={cn(
          "mx-2 mb-2 rounded-md bg-secondary/50 border border-border transition-all duration-300",
          collapsed
            ? "opacity-0 pointer-events-none h-0 mb-0 overflow-hidden"
            : "opacity-100",
        )}
      >
        {teamName && (
          <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-2 border-b border-border/50">
            <Building2 className="w-3 h-3 text-accent shrink-0" />
            <span className="text-[11px] font-medium text-foreground truncate">
              {teamName}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground p-2.5">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              mounted && isConnected
                ? "bg-success"
                : "bg-warning animate-pulse",
            )}
          />
          <span className="truncate">
            {mounted && isConnected && shortAddress
              ? shortAddress
              : "Not connected"}
          </span>
        </div>
        {mounted && isConnected && (
          <p className="text-[10px] text-muted-foreground/50 px-2.5 pb-2 -mt-1 truncate">
            {networkLabel}
          </p>
        )}
      </div>

      <div className="border-t border-sidebar-border px-2 py-2">
        <a
          href={DASHBOARD_DOCS_URL}
          target="_blank"
          rel="noreferrer"
          title={collapsed ? "Open docs" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-muted-foreground transition hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            collapsed ? "justify-center" : "",
          )}
        >
          <BookOpen className="h-4 w-4 shrink-0" />
          <span
            className={cn(
              "whitespace-nowrap text-xs transition-all duration-300",
              collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100",
            )}
          >
            Open Docs
          </span>
          {!collapsed && <ArrowUpRight className="ml-auto h-3.5 w-3.5" />}
        </a>
      </div>

      {/* Collapse button */}
      <div className="p-2 border-t border-sidebar-border">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-150"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
