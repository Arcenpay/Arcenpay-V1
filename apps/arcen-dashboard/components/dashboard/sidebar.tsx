"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { useAccount } from "wagmi";
import {
  LayoutDashboard,
  LayoutGrid,
  Users,
  ReceiptText,
  Settings,
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
  LifeBuoy,
  ChevronUp,
  Sparkles,
  LogOut,
  UserRound,
  Search,
} from "lucide-react";
import { CommandPalette } from "./command-palette";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { DASHBOARD_DOCS_URL } from "@/lib/docs-url";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import { useEnvironment } from "@/contexts/environment-context";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
}

type NavItem = {
  id: Section;
  label: string;
};

type NavGroup = {
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  items: NavItem[];
  collapsible?: boolean;
};

const navGroups: NavGroup[] = [
  {
    label: "Home",
    icon: LayoutDashboard,
    items: [{ id: "overview", label: "Overview" }],
  },
  {
    label: "Products",
    icon: LayoutGrid,
    collapsible: true,
    items: [
      { id: "catalog-plans", label: "Catalogue" },
      { id: "catalog-addons", label: "Add-Ons" },
      { id: "catalog-credits", label: "Credits" },
      { id: "catalog-config", label: "Configuration" },
    ],
  },
  {
    label: "Customers",
    icon: Users,
    collapsible: true,
    items: [
      { id: "companies", label: "Companies" },
      { id: "subscribers", label: "Users" },
    ],
  },
  {
    label: "Features",
    icon: Flag,
    collapsible: true,
    items: [
      { id: "features", label: "Entitlements" },
      { id: "feature-flags", label: "Flags" },
    ],
  },
  {
    label: "Connections",
    icon: Activity,
    collapsible: true,
    items: [
      { id: "events-stream", label: "Events" },
      { id: "components", label: "Components" },
      { id: "webhooks", label: "Webhooks" },
    ],
  },
  {
    label: "Agent",
    icon: Bot,
    items: [{ id: "agent", label: "Agent" }],
  },
  {
    label: "Billing",
    icon: CreditCard,
    collapsible: true,
    items: [
      { id: "invoices", label: "Invoices" },
      { id: "payments", label: "Payments" },
      { id: "billing", label: "Billing & Plan" },
      { id: "audit-log", label: "Audit Log" },
    ],
  },
  {
    label: "Settings",
    icon: Settings,
    items: [{ id: "settings", label: "Settings" }],
  },
];

function isGroupActive(items: NavItem[], activeSection: Section) {
  return items.some((item) => item.id === activeSection);
}

export function Sidebar({
  activeSection,
  onSectionChange,
  mobileOpen = false,
  onMobileOpenChange,
}: SidebarProps) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { envMode, activeEnvironment } = useEnvironment();
  const { data: sessionData, refresh: refreshSessionData } = useDashboardSession();
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // Accordion: only one group open at a time, default all closed
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const accountRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-expand the group containing the active section (on mount / section change)
  useEffect(() => {
    const parentGroup = navGroups.find(
      (g) => g.collapsible && g.items.some((i) => i.id === activeSection),
    );
    if (parentGroup) {
      setExpandedGroup(parentGroup.label);
    } else {
      // Single-page item selected — collapse all groups
      setExpandedGroup(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // Close account menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    if (showAccountMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showAccountMenu]);

  const handleGroupClick = (group: NavGroup) => {
    if (!group.collapsible) {
      // Non-collapsible: just select the first (and only) item
      if (group.items.length > 0) {
        onSectionChange(group.items[0].id);
      }
      return;
    }
    if (expandedGroup === group.label) {
      // Already open — close it
      setExpandedGroup(null);
    } else {
      // Open this group, close others, and auto-select first item
      setExpandedGroup(group.label);
      if (group.items.length > 0) {
        onSectionChange(group.items[0].id);
      }
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleSwitchTeam = async (teamId: string) => {
    if (!sessionData || sessionData.currentTeam?.id === teamId) {
      setShowAccountMenu(false);
      return;
    }
    setIsSwitchingTeam(true);
    try {
      const response = await fetch("/api/team/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) return;
      await refreshSessionData();
      setShowAccountMenu(false);
      window.location.reload();
    } finally {
      setIsSwitchingTeam(false);
    }
  };

  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : null;

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen ? (
        <div
          className="fixed inset-0 z-[35] bg-black/60 lg:hidden backdrop-blur-sm"
          onClick={() => onMobileOpenChange?.(false)}
        />
      ) : null}

      <aside
        className={cn(
          "fixed left-0 top-0 z-50 h-screen bg-sidebar flex flex-col border-r border-sidebar-border",
          "max-lg:translate-x-[-100%] transition-transform duration-300 ease-out",
          mobileOpen ? "max-lg:translate-x-0" : "",
          "w-[min(280px,85vw)] lg:w-[260px]",
        )}
      >
        {/* Mobile drawer header */}
        <div className="lg:hidden h-14 flex items-center justify-between px-4 shrink-0">
          <Image
            src="/arcenpay-logo.png"
            alt="ArcenPay"
            width={140}
            height={36}
            className="h-7 w-auto object-contain dark:brightness-0 dark:invert"
            priority
            unoptimized
          />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-[var(--sidebar-hover)] transition-colors"
          >
            <Search className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => onMobileOpenChange?.(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-[var(--sidebar-hover)] transition-colors"
          >
            <X className="w-5 h-5" strokeWidth={1.5} />
          </button>
        </div>

        {/* Logo + Search — desktop only */}
        <div className="hidden lg:flex h-14 items-center justify-between px-5 shrink-0">
          <Image
            src="/arcenpay-logo.png"
            alt="ArcenPay"
            width={140}
            height={36}
            className="h-7 w-auto object-contain dark:brightness-0 dark:invert"
            priority
            unoptimized
          />
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-[var(--sidebar-hover)] transition-colors"
            title="Search"
          >
            <Search className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 overflow-y-auto overflow-x-hidden">
          {navGroups.map((group, gi) => {
            const GroupIcon = group.icon;
            const isExpanded = group.collapsible ? expandedGroup === group.label : true;
            const isGroupActive = group.items.some((i) => i.id === activeSection);


            return (
              <div key={gi} className={gi > 0 ? "mt-0.5" : ""}>
                {/* Group header with icon */}
                <button
                  onClick={() => handleGroupClick(group)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 w-full text-[13px] font-medium select-none transition-all duration-150 rounded-xl",
                    isGroupActive
                      ? "bg-[var(--sidebar-active)] text-sidebar-foreground"
                      : "text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-[var(--sidebar-hover)]",
                  )}
                >
                  <GroupIcon className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                  <span>{group.label}</span>
                </button>

                {/* Sub-items — only for collapsible groups */}
                {group.collapsible && (
                  <div
                    className={cn(
                      "transition-all duration-200",
                      !isExpanded ? "max-h-0 overflow-hidden" : "max-h-[800px]",
                    )}
                  >
                    {group.items.map((item, ii) => {
                      const isActive = activeSection === item.id;
                      const isFirst = ii === 0;
                      const isLast = ii === group.items.length - 1;

                      return (
                        <div
                          key={item.id}
                          className="relative pl-[28px]"
                        >
                          {/* Left vertical line — centered under group icon */}
                          <div
                            className={cn(
                              "absolute left-[19px] w-[2px] bg-sidebar-border/70",
                              isFirst ? "top-[-4px] bottom-0" : "",
                              isLast && !isFirst ? "top-0 bottom-3" : "",
                              !isFirst && !isLast ? "top-0 bottom-0" : "",
                            )}
                          />

                          <button
                            onClick={() => onSectionChange(item.id)}
                            className={cn(
                              "w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                              isActive
                                ? "text-sidebar-foreground"
                                : "text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-[var(--sidebar-hover)]",
                            )}
                          >
                            {item.label}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Bottom section */}
        <div className="px-3 pb-3 space-y-1">
          {/* Promo card */}
          <div className="rounded-xl bg-[var(--sidebar)] border border-sidebar-border p-3.5 mb-2 text-sidebar-foreground shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-brand" strokeWidth={1.5} />
              <span className="text-[13px] font-medium text-sidebar-foreground">Annual plan savings</span>
            </div>
            <p className="text-[12px] text-sidebar-foreground/60 leading-relaxed mb-2">
              Save 20% with annual billing on eligible plans.
            </p>
            <button
              onClick={() => onSectionChange("billing")}
              className="text-[13px] font-medium text-brand hover:opacity-80 transition-opacity"
            >
              Upgrade
            </button>
          </div>

          {/* Support links */}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); onSectionChange("settings"); }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-[var(--sidebar-hover)] transition-all duration-150"
          >
            <LifeBuoy className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>Support</span>
          </a>
          <a
            href={DASHBOARD_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/80 hover:bg-[var(--sidebar-hover)] transition-all duration-150"
          >
            <BookOpen className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            <span>Documentation</span>
            <ArrowUpRight className="ml-auto w-3.5 h-3.5 opacity-40" strokeWidth={1.5} />
          </a>

          {/* Divider */}
          <div className="h-px bg-sidebar-border/50 my-2" />

          {/* Theme toggle */}
          {mounted ? (
            <div className="flex items-center gap-1 rounded-lg border border-sidebar-border/50 p-1">
              <button
                onClick={() => setTheme("light")}
                title="Light mode"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200 flex-1 h-7",
                  theme === "light"
                    ? "bg-[var(--sidebar-active)] text-sidebar-foreground"
                    : "text-sidebar-foreground/40 hover:text-sidebar-foreground/80",
                )}
              >
                <Sun className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setTheme("dark")}
                title="Dark mode"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200 flex-1 h-7",
                  theme === "dark"
                    ? "bg-[var(--sidebar-active)] text-sidebar-foreground"
                    : "text-sidebar-foreground/40 hover:text-sidebar-foreground/80",
                )}
              >
                <Moon className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => setTheme("system")}
                title="System theme"
                className={cn(
                  "flex items-center justify-center rounded-md transition-all duration-200 flex-1 h-7",
                  theme === "system"
                    ? "bg-[var(--sidebar-active)] text-sidebar-foreground"
                    : "text-sidebar-foreground/40 hover:text-sidebar-foreground/80",
                )}
              >
                <Monitor className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
          ) : null}

          {/* Account profile — bottom left */}
          {sessionData?.user?.email && (
            <div ref={accountRef} className="relative mt-1">
              <button
                onClick={() => setShowAccountMenu((v) => !v)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--sidebar-hover)] transition-colors"
              >
                {sessionData.user.email ? (
                  <img
                    src={`https://api.dicebear.com/9.x/dylan/svg?seed=${encodeURIComponent(sessionData.user.email)}`}
                    alt="avatar"
                    className="h-7 w-7 rounded-full border border-sidebar-border bg-[var(--sidebar-hover)] shrink-0"
                  />
                ) : (
                  <UserRound className="h-7 w-7 shrink-0 text-sidebar-foreground/40" strokeWidth={1.5} />
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-[13px] font-medium text-sidebar-foreground truncate">
                    {sessionData.currentTeam?.name ?? "Workspace"}
                  </p>
                  <p className="text-[11px] text-sidebar-foreground/40 truncate">
                    {shortAddress ?? "No wallet"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <div
                    className={cn(
                      "w-2 h-2 rounded-full",
                      mounted && isConnected ? "bg-green-500" : "bg-yellow-500 animate-pulse",
                    )}
                  />
                  <ChevronUp
                    className={cn(
                      "w-3.5 h-3.5 text-sidebar-foreground/30 transition-transform duration-200",
                      showAccountMenu ? "rotate-180" : "",
                    )}
                    strokeWidth={1.5}
                  />
                </div>
              </button>

              {/* Account dropdown */}
              {showAccountMenu && (
                <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-xl border border-sidebar-border bg-popover p-2 shadow-lg">
                  <div className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Switch workspace
                  </div>
                  <div className="space-y-1">
                    {sessionData.teams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        disabled={isSwitchingTeam}
                        onClick={() => void handleSwitchTeam(team.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors",
                          sessionData.currentTeam?.id === team.id
                            ? "bg-secondary text-foreground"
                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                        )}
                      >
                        <div>
                          <div className="text-sm font-medium">{team.name}</div>
                          <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground/70">
                            {team.role}
                          </div>
                        </div>
                        {sessionData.currentTeam?.id === team.id ? (
                          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">
                            Active
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAccountMenu(false);
                        router.push("/?section=settings&tab=workspace", { scroll: false });
                      }}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                    >
                      <span>Manage workspace</span>
                      <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                        Settings
                      </span>
                    </button>
                  </div>
                  <div className="mt-2 border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => void handleLogout()}
                      disabled={isLoggingOut}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                    >
                      <LogOut className="h-4 w-4" strokeWidth={1.5} />
                      {isLoggingOut ? "Signing out..." : "Sign out"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
    </>
  );
}
