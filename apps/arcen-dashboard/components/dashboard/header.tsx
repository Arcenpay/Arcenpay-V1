"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { Bell, Search, ChevronDown, LogOut, UserRound, Wallet } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { BASE_SEPOLIA_CHAIN_ID, getChainLabel } from "@/lib/default-chain";
import {
  REQUIRED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";

type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  actorType: string;
};

interface HeaderProps {
  activeSection: Section;
}

const sectionTitles: Record<Section, string> = {
  overview: "Overview",
  "catalog-plans": "Plans",
  "catalog-addons": "Add-Ons",
  "catalog-credits": "Credits",
  "catalog-config": "Configuration",
  subscribers: "Users",
  invoices: "Invoices",
  sessions: "Sessions",
  features: "Entitlements",
  components: "Components",
  billing: "Billing & Plan",
  payments: "Payments",
  "audit-log": "Audit Log",
  settings: "Settings",
  companies: "Companies",
  "events-stream": "Events",
  "feature-flags": "Feature Flags",
  agent: "Agent",
  webhooks: "Webhooks",
};

const sectionDescriptions: Record<Section, string> = {
  overview: "Protocol health at a glance",
  "catalog-plans": "Create and manage blockchain subscription plans",
  "catalog-addons": "Create and publish add-on products",
  "catalog-credits": "Create and publish credit pack types",
  "catalog-config": "Environment mode and chain configuration",
  subscribers: "Identified users, contact points, and last-seen activity",
  invoices: "Search, download, and resend invoices",
  sessions: "ZKVUB agent sessions",
  features: "On-chain entitlement flags per subscription tier",
  components: "UI component library",
  billing: "Manage your platform tier, gas budget, and support",
  payments: "Hosted payment links, checkout sessions, and one-time charges",
  "audit-log": "Immutable record of all team actions",
  settings: "Provider configuration",
  companies: "Manage companies, entitlements, and overrides",
  "events-stream": "Live stream of track and identify events",
  "feature-flags": "Manage flags, targeting rules, and zkTLS conditions",
  agent: "AI agent SDK, API keys, session management, auto-topup & dispatch",
  webhooks: "Configure endpoints, signing secrets, and delivery logs",
};

export function Header({ activeSection }: HeaderProps) {
  const router = useRouter();
  const [searchFocused, setSearchFocused] = useState(false);
  const { data: sessionData, refresh: refreshSessionData } = useDashboardSession();
  const storedWallet = sessionData?.user.walletAddress ?? null;
  const {
    connectedWalletLabel,
    currentNetworkLabel,
    disconnectWallet,
    hasConnectedWallet,
    isDisconnecting,
    isLinkedWalletConnected,
    isOnRequiredNetwork,
    isSwitchingChain,
    isWrongWalletConnected,
    linkedWalletLabel,
    openAccountModal,
    openConnectModal,
    reconnectWallet,
    switchToRequiredNetwork,
  } = useDashboardWallet(storedWallet);

  // Notification bell state
  const [showNotifications, setShowNotifications] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  // Fetch recent audit events for bell dropdown
  useEffect(() => {
    fetch("/api/audit-log?limit=10")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.entries) {
          setAuditEvents(d.entries);
          const lastViewed = localStorage.getItem("arcen_notif_last_viewed");
          if (lastViewed) {
            const count = d.entries.filter(
              (e: AuditEntry) => new Date(e.createdAt) > new Date(lastViewed),
            ).length;
            setUnreadCount(count);
          } else {
            setUnreadCount(d.entries.length);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Close notification dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) {
        setShowWalletMenu(false);
      }
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setShowWorkspaceMenu(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    if (showNotifications || showWalletMenu || showWorkspaceMenu || showAccountMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showAccountMenu, showNotifications, showWalletMenu, showWorkspaceMenu]);

  const markAllRead = useCallback(() => {
    localStorage.setItem("arcen_notif_last_viewed", new Date().toISOString());
    setUnreadCount(0);
  }, []);

  const formatAction = (action: string) =>
    action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const handleSwitchTeam = async (teamId: string) => {
    if (!sessionData || sessionData.currentTeam?.id === teamId) {
      setShowWorkspaceMenu(false);
      return;
    }

    setIsSwitchingTeam(true);
    try {
      const response = await fetch("/api/team/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) {
        return;
      }

      await refreshSessionData();
      setShowWorkspaceMenu(false);
      window.location.reload();
    } finally {
      setIsSwitchingTeam(false);
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

  return (
    <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-semibold text-foreground">
          {sectionTitles[activeSection]}
        </h1>
        <span className="hidden md:block text-sm text-muted-foreground">
          {sectionDescriptions[activeSection]}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* Environment Badge */}
        <Badge
          variant="outline"
          className={cn(
            "text-xs font-medium px-2.5 py-1",
            "border-blue-400/50 text-blue-400 bg-blue-400/5",
          )}
        >
          {getChainLabel(BASE_SEPOLIA_CHAIN_ID)}
        </Badge>

        {/* Search */}
        <div
          className={cn(
            "relative flex items-center transition-all duration-300",
            searchFocused ? "w-64" : "w-48",
          )}
        >
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-secondary border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-accent transition-all duration-200"
          />
        </div>

        {/* Notifications */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => {
              setShowNotifications((v) => !v);
              if (!showNotifications) markAllRead();
            }}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-11 w-80 max-h-96 overflow-y-auto rounded-xl border border-border bg-popover shadow-lg z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-medium text-foreground">
                  Recent Activity
                </span>
                {auditEvents.length > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {auditEvents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No recent activity
                </div>
              ) : (
                <ul>
                  {auditEvents.map((ev) => (
                    <li
                      key={ev.id}
                      className="px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/50"
                    >
                      <p className="text-sm text-foreground font-medium truncate">
                        {formatAction(ev.action)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {ev.resourceType} &middot;{" "}
                        {new Date(ev.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* Wallet button */}
        <div ref={walletRef} className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowWalletMenu((open) => !open)}
            className="h-9 gap-2 px-3 font-mono text-xs text-muted-foreground hover:text-foreground"
            title={storedWallet ? `Provider wallet: ${storedWallet}` : "Provider wallet"}
          >
            <Wallet className="h-3.5 w-3.5" />
            {storedWallet
              ? `${storedWallet.slice(0, 6)}…${storedWallet.slice(-4)}`
              : "Wallet"}
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>

          {showWalletMenu ? (
            <div className="absolute right-0 top-11 z-50 w-80 rounded-2xl border border-border bg-popover p-2 shadow-lg">
              <div className="rounded-xl bg-secondary/70 px-3 py-3">
                <p className="text-sm font-medium text-foreground">Provider wallet</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {storedWallet ?? "No wallet linked yet"}
                </p>
              </div>
              <div className="mt-2 rounded-xl border border-border/70 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Connected wallet
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {connectedWalletLabel ?? "Not connected"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Network: {currentNetworkLabel ?? "Not connected"}
                </p>
              </div>
              <div className="mt-2 rounded-xl border border-border/70 px-3 py-3">
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Active network
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {REQUIRED_WALLET_CHAIN_LABEL}
                </p>
              </div>
              {!isLinkedWalletConnected && linkedWalletLabel && hasConnectedWallet ? (
                <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-700">
                  Connected wallet does not match {linkedWalletLabel}. Reconnect with the linked wallet for on-chain actions.
                </div>
              ) : null}
              {hasConnectedWallet && !isOnRequiredNetwork ? (
                <div className="mt-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3 text-xs text-amber-700">
                  Switch this wallet to {REQUIRED_WALLET_CHAIN_LABEL} before using dashboard transactions.
                </div>
              ) : null}
              <div className="mt-2 grid gap-2">
                {!hasConnectedWallet ? (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => void openConnectModal()}
                  >
                    Connect wallet
                  </Button>
                ) : null}
                {isWrongWalletConnected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => void reconnectWallet()}
                  >
                    Reconnect correct wallet
                  </Button>
                ) : null}
                {hasConnectedWallet && !isOnRequiredNetwork ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => void switchToRequiredNetwork()}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain
                      ? "Switching network..."
                      : `Switch to ${REQUIRED_WALLET_CHAIN_LABEL}`}
                  </Button>
                ) : null}
                {hasConnectedWallet ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onClick={() => void openAccountModal()}
                  >
                    Open wallet modal
                  </Button>
                ) : null}
                {hasConnectedWallet ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full"
                    onClick={() => void disconnectWallet()}
                    disabled={isDisconnecting}
                  >
                    {isDisconnecting ? "Disconnecting..." : "Disconnect wallet"}
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowWalletMenu(false);
                    router.push("/?section=settings&tab=wallet", { scroll: false });
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                >
                  <span>Manage wallet settings</span>
                  <span className="text-[11px] uppercase tracking-[0.14em]">
                    Settings
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div ref={workspaceRef} className="relative">
          <button
            type="button"
            onClick={() => setShowWorkspaceMenu((open) => !open)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-secondary px-3 text-xs font-medium text-foreground"
          >
            <span className="max-w-[11rem] truncate">
              {sessionData?.currentTeam?.name ?? "Workspace"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {showWorkspaceMenu && sessionData ? (
            <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-border bg-popover p-2 shadow-lg">
              <div className="px-3 pb-2 pt-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
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
                      "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-colors",
                      sessionData.currentTeam?.id === team.id
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    <div>
                      <div className="text-sm font-medium">{team.name}</div>
                      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground/80">
                        {team.role}
                      </div>
                    </div>
                    {sessionData.currentTeam?.id === team.id ? (
                      <span className="text-[11px] uppercase tracking-[0.14em] text-accent">
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
                    setShowWorkspaceMenu(false);
                    router.push("/?section=settings&tab=workspace", { scroll: false });
                  }}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-foreground"
                >
                  <span>Manage workspace</span>
                  <span className="text-[11px] uppercase tracking-[0.14em]">
                    Settings
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div ref={accountRef} className="relative">
          <button
            type="button"
            onClick={() => setShowAccountMenu((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-foreground"
          >
            <UserRound className="h-4 w-4" />
          </button>

          {showAccountMenu && sessionData ? (
            <div className="absolute right-0 top-11 z-50 w-72 rounded-2xl border border-border bg-popover p-2 shadow-lg">
              <div className="rounded-xl bg-secondary/70 px-3 py-3">
                <p className="text-sm font-medium text-foreground">
                  {sessionData.currentTeam?.name ?? "ArcenPay"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sessionData.user.email ?? "No email"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
                className="mt-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                {isLoggingOut ? "Signing out..." : "Sign out"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
