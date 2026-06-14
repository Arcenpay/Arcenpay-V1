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
  ChevronDown,
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
  Sun,
  Moon,
  Monitor,
  X,
} from "lucide-react";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { DASHBOARD_DOCS_URL } from "@/lib/docs-url";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import { useEnvironment } from "@/contexts/environment-context";
import { useTheme } from "next-themes";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

type NavItem = {
  id: Section;
  label: string;
  icon: React.ElementType;
  parent?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
  collapsible?: boolean;
};

const navGroups: NavGroup[] = [
  {
    label: "",
    items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Catalog",
    collapsible: true,
    items: [
      { id: "catalog-plans", label: "Plans", icon: Layers },
      { id: "catalog-addons", label: "Add-Ons", icon: Package },
      { id: "catalog-credits", label: "Credits", icon: Coins },
      { id: "catalog-config", label: "Configuration", icon: SlidersHorizontal },
    ],
  },
  {
    label: "Manage",
    collapsible: true,
    items: [
      { id: "companies", label: "Companies", icon: Building2 },
      { id: "subscribers", label: "Users", icon: Users },
      { id: "features", label: "Features", icon: Flag },
      { id: "feature-flags", label: "Flags", icon: Zap },
    ],
  },
  {
    label: "Connections",
    collapsible: true,
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
    collapsible: true,
    items: [
      { id: "invoices", label: "Invoices", icon: ReceiptText },
      { id: "payments", label: "Payments", icon: CreditCard },
      { id: "billing", label: "Billing & Plan", icon: CreditCard },
      { id: "audit-log", label: "Audit Log", icon: ClipboardList },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];

// Check if a group is active based on any of its items being active
function isGroupActive(items: NavItem[], activeSection: Section) {
  return items.some((item) => item.id === activeSection);
}

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
  mobileOpen = false,
  onMobileOpenChange,
}: SidebarProps) {
  const { address, isConnected } = useAccount();
  const { envMode, activeEnvironment } = useEnvironment();
  const { data: sessionData } = useDashboardSession();
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(navGroups.filter((g) => g.collapsible).map((g) => g.label)),
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-expand groups that contain the active section
  useEffect(() => {
    const newExpanded = new Set(expandedGroups);
    navGroups.forEach((group) => {
      if (group.collapsible && isGroupActive(group.items, activeSection)) {
        newExpanded.add(group.label);
      }
    });
    setExpandedGroups(newExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const teamName = sessionData?.currentTeam?.name ?? null;
  const shortAddress = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : null;
  const networkLabel = activeEnvironment?.chainLabel ?? getChainLabel(resolveEnvironmentChainId(envMode));

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-[35] bg-black/50 lg:hidden"
          onClick={() => onMobileOpenChange?.(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col",
          // Mobile: slide in/out
          "max-lg:translate-x-[-100%]",
          mobileOpen ? "max-lg:translate-x-0" : "",
          // Width
          "w-[min(280px,85vw)] lg:w-[68px]",
          !collapsed && "lg:w-[240px]",
        )}
      >
        {/* Mobile drawer header */}
        <div className="lg:hidden h-14 flex items-center justify-between px-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-sidebar-primary">
              <Hexagon className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            <span className="font-semibold text-sm text-sidebar-foreground">
              ArcenPay
            </span>
          </div>
          <button
            type="button"
            onClick={() => onMobileOpenChange?.(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Logo — desktop only */}
        <div className="hidden lg:flex h-14 items-center px-4 border-b border-sidebar-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-sidebar-primary">
              <Hexagon className="w-4 h-4 text-sidebar-primary-foreground" />
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
          {navGroups.map((group, gi) => {
            const groupActive = isGroupActive(group.items, activeSection);
            const isExpanded = group.collapsible ? expandedGroups.has(group.label) : true;

            return (
              <div key={gi} className={gi > 0 ? "mt-3" : ""}>
                {/* Group label / collapsible header */}
                {group.label && (
                  <div className={cn(
                    "flex items-center transition-all duration-300",
                    collapsed && !mobileOpen ? "opacity-0 h-0 overflow-hidden mb-0" : "opacity-100 mb-1",
                  )}>
                    {group.collapsible ? (
                      <button
                        onClick={() => toggleGroup(group.label)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1 w-full text-[11px] font-medium uppercase tracking-[0.12em] select-none transition-colors",
                          groupActive || isExpanded
                            ? "text-sidebar-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span>{group.label}</span>
                        <ChevronDown
                          className={cn(
                            "w-3 h-3 transition-transform duration-200",
                            isExpanded ? "rotate-0" : "-rotate-90",
                          )}
                        />
                      </button>
                    ) : (
                      <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground select-none">
                        {group.label}
                      </p>
                    )}
                  </div>
                )}
                {/* Divider in collapsed state */}
                {group.label && collapsed && !mobileOpen && (
                  <div className="mx-3 h-px bg-sidebar-border mb-2" />
                )}

                {/* Items */}
                <div className={cn(
                  "space-y-0.5 transition-all duration-200",
                  group.collapsible && !isExpanded && !collapsed && !mobileOpen ? "max-h-0 overflow-hidden" : "max-h-[1000px]",
                )}>
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;

                    return (
                      <button
                        key={item.id}
                        onClick={() => onSectionChange(item.id)}
                        title={collapsed && !mobileOpen ? item.label : undefined}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 relative",
                          isActive
                            ? "bg-sidebar-accent text-sidebar-foreground"
                            : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
                        )}
                      >
                        {/* Active indicator line */}
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full bg-sidebar-primary" />
                        )}
                        <Icon
                          className={cn(
                            "w-[18px] h-[18px] shrink-0",
                            isActive
                              ? "text-sidebar-foreground"
                              : "text-muted-foreground",
                          )}
                        />
                        <span
                          className={cn(
                            "whitespace-nowrap transition-all duration-300",
                            collapsed && !mobileOpen
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
            );
          })}
        </nav>

        {/* Team + Wallet status — desktop only */}
        <div
          className={cn(
            "hidden lg:block mx-3 mb-3 rounded-lg border border-sidebar-border transition-all duration-300",
            collapsed
              ? "opacity-0 pointer-events-none h-0 mb-0 overflow-hidden"
              : "opacity-100",
          )}
        >
          {teamName && (
            <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-sidebar-border/50">
              <Building2 className="w-3.5 h-3.5 text-sidebar-foreground shrink-0" />
              <span className="text-[12px] font-medium text-sidebar-foreground truncate">
                {teamName}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground p-3">
            <div
              className={cn(
                "w-2 h-2 rounded-full shrink-0",
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
            <p className="text-[10px] text-muted-foreground/40 px-3 pb-2 -mt-1 truncate">
              {activeEnvironment?.name ? `${activeEnvironment.name} · ${networkLabel}` : networkLabel}
            </p>
          )}
        </div>

        <div className="border-t border-sidebar-border px-2 py-3">
          {/* Theme toggle */}
          {mounted ? (
            <div
              className={cn(
                "flex items-center gap-1 rounded-lg border border-sidebar-border mb-2 transition-all duration-300",
                collapsed && !mobileOpen ? "justify-center p-1.5" : "p-1",
              )}
            >
              <button
                onClick={() => setTheme("light")}
                title="Light mode"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200",
                  collapsed && !mobileOpen ? "w-8 h-8" : "flex-1 h-7",
                  theme === "light"
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground",
                )}
              >
                <Sun className="w-3.5 h-3.5" />
                {!(collapsed && !mobileOpen) && <span className="ml-1.5 text-[10px] font-medium">Light</span>}
              </button>
              <button
                onClick={() => setTheme("dark")}
                title="Dark mode"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200",
                  collapsed && !mobileOpen ? "w-8 h-8" : "flex-1 h-7",
                  theme === "dark"
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground",
                )}
              >
                <Moon className="w-3.5 h-3.5" />
                {!(collapsed && !mobileOpen) && <span className="ml-1.5 text-[10px] font-medium">Dark</span>}
              </button>
              <button
                onClick={() => setTheme("system")}
                title="System theme"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200",
                  collapsed && !mobileOpen ? "w-8 h-8" : "flex-1 h-7",
                  theme === "system"
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:text-sidebar-foreground",
                )}
              >
                <Monitor className="w-3.5 h-3.5" />
                {!(collapsed && !mobileOpen) && <span className="ml-1.5 text-[10px] font-medium">Auto</span>}
              </button>
            </div>
          ) : null}

          <a
            href={DASHBOARD_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            title={collapsed && !mobileOpen ? "Open docs" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              collapsed && !mobileOpen ? "justify-center" : "",
            )}
          >
            <BookOpen className="h-[18px] w-[18px] shrink-0" />
            <span
              className={cn(
                "whitespace-nowrap transition-all duration-300",
                collapsed && !mobileOpen ? "opacity-0 w-0 overflow-hidden" : "opacity-100",
              )}
            >
              Open Docs
            </span>
            {!(collapsed && !mobileOpen) && <ArrowUpRight className="ml-auto h-3.5 w-3.5 opacity-50" />}
          </a>
        </div>

        {/* Collapse button — desktop only */}
        <div className="hidden lg:block p-2 border-t border-sidebar-border">
          <button
            onClick={() => onCollapsedChange(!collapsed)}
            className="w-full flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-all duration-150"
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
    </>
  );
}
