"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { Bell, Search, ChevronDown, LogOut, UserRound, Wallet, Building2 } from "lucide-react";
import { Web3Icon } from "@/components/web3-icon";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useChainId } from "wagmi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDashboardSession } from "@/hooks/use-dashboard-session";
import { getChainLabel, resolveEnvironmentChainId } from "@/lib/default-chain";
import {
  SUPPORTED_WALLET_CHAIN_LABEL,
  useDashboardWallet,
} from "@/hooks/use-dashboard-wallet";
import { useEnvironment } from "@/contexts/environment-context";

type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  resourceType: string;
  actorType: string;
};

interface HeaderProps {
  activeSection: Section;
  onMobileMenuToggle?: () => void;
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

export function Header({ activeSection, onMobileMenuToggle }: HeaderProps) {
  const router = useRouter();
  const {
    envMode,
    activeEnvironment,
    environments,
    selectEnvironment,
  } = useEnvironment();
  const chainId = useChainId();
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
    isSwitchingChain,
    isWrongWalletConnected,
    linkedWalletLabel,
    openAccountModal,
    openConnectModal,
    reconnectWallet,
    switchToRequiredNetwork,
  } = useDashboardWallet(storedWallet);
  const configuredChainId = activeEnvironment?.chainId ?? resolveEnvironmentChainId(envMode);
  const configuredChainLabel = getChainLabel(configuredChainId);
  const isOnConfiguredNetwork = hasConnectedWallet && chainId === configuredChainId;

  const [showNotifications, setShowNotifications] = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showEnvironmentMenu, setShowEnvironmentMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [isSwitchingTeam, setIsSwitchingTeam] = useState(false);
  const [isSwitchingEnvironment, setIsSwitchingEnvironment] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const environmentRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowNotifications(false);
      }
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) {
        setShowWalletMenu(false);
      }
      if (environmentRef.current && !environmentRef.current.contains(e.target as Node)) {
        setShowEnvironmentMenu(false);
      }
      if (workspaceRef.current && !workspaceRef.current.contains(e.target as Node)) {
        setShowWorkspaceMenu(false);
      }
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    if (showNotifications || showWalletMenu || showEnvironmentMenu || showWorkspaceMenu || showAccountMenu) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showAccountMenu, showEnvironmentMenu, showNotifications, showWalletMenu, showWorkspaceMenu]);

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
      if (!response.ok) return;
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

  const handleSelectEnvironment = async (environmentId: string) => {
    if (activeEnvironment?.id === environmentId) {
      setShowEnvironmentMenu(false);
      return;
    }
    setIsSwitchingEnvironment(true);
    try {
      const ok = await selectEnvironment(environmentId);
      if (!ok) return;
      setShowEnvironmentMenu(false);
      await refreshSessionData();
      window.location.reload();
    } finally {
      setIsSwitchingEnvironment(false);
    }
  };

  return (
    <header className="h-14 border-b border-border bg-background sticky top-0 z-30 flex items-center justify-between px-4 md:px-6 min-w-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Mobile hamburger */}
        {onMobileMenuToggle && (
            <button
            type="button"
            onClick={onMobileMenuToggle}
            className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-muted/50 transition-colors shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        )}
        <div className="min-w-0 overflow-hidden">
          <h1 className="text-base font-semibold text-foreground tracking-tight truncate">
            {sectionTitles[activeSection]}
          </h1>
          <span className="hidden md:block text-[13px] text-muted-foreground truncate">
            {sectionDescriptions[activeSection]}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3 shrink-0">
        {/* Environment switcher */}
        <div ref={environmentRef} className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => setShowEnvironmentMenu((open) => !open)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-raised transition-colors"
          >
            {activeEnvironment?.chainLabel && (
              <Web3Icon chainLabel={activeEnvironment.chainLabel} size="sm" />
            )}
            <span className="max-w-[9rem] truncate">
              {activeEnvironment?.name ?? "Environment"}
            </span>
            <Badge
              variant="outline"
              className={cn(
                "px-2 py-0.5 text-[10px] font-semibold border-none",
                activeEnvironment?.mode === "PRODUCTION"
                  ? "bg-secondary text-destructive"
                  : "bg-secondary text-warning",
              )}
            >
              {activeEnvironment?.mode === "PRODUCTION" ? "PROD" : "DEV"}
            </Badge>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>

          {showEnvironmentMenu ? (
            <div className="absolute right-0 top-11 z-50 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-2">
              <div className="px-3 pb-2 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Active environment
              </div>
              <div className="space-y-1">
                {environments.map((environment) => (
                  <button
                    key={environment.id}
                    type="button"
                    disabled={isSwitchingEnvironment}
                    onClick={() => void handleSelectEnvironment(environment.id)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors",
                      activeEnvironment?.id === environment.id
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {environment.chainLabel && (
                        <Web3Icon chainLabel={environment.chainLabel} size="sm" />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{environment.name}</div>
                        <div className="truncate text-xs text-muted-foreground/70">
                          {environment.chainLabel}
                        </div>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "border-none text-[10px]",
                        environment.mode === "PRODUCTION"
                          ? "bg-secondary text-destructive"
                          : "bg-secondary text-warning",
                      )}
                    >
                      {environment.mode === "PRODUCTION" ? "PROD" : "DEV"}
                    </Badge>
                  </button>
                ))}
              </div>
              <div className="mt-2 border-t border-border pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEnvironmentMenu(false);
                    router.push("/onboarding/environment");
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <span>Create environment</span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-foreground">
                    New
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowEnvironmentMenu(false);
                    router.push("/?section=settings&tab=workspace", { scroll: false });
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <span>Manage environments</span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Settings
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Search */}
        <div
          className={cn(
            "relative flex items-center transition-all duration-300 hidden md:flex",
            searchFocused ? "w-64" : "w-48",
          )}
        >
          <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search..."
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            className="w-full h-9 pl-9 pr-4 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-0 focus:border-border transition-all duration-200"
          />
        </div>

        {/* Notifications */}
        <div ref={bellRef} className="relative">
          <button
            onClick={() => {
              setShowNotifications((v) => !v);
              if (!showNotifications) markAllRead();
            }}
            className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-foreground" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-11 w-[min(20rem,calc(100vw-1rem))] max-h-96 overflow-y-auto rounded-xl border border-border bg-popover z-50">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-sm font-medium text-foreground">
                  Recent Activity
                </span>
                {auditEvents.length > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                      className="px-4 py-3 border-b border-border last:border-0 hover:bg-secondary/50 transition-colors"
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
            className="h-9 gap-1.5 sm:gap-2 px-2 sm:px-3 font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50"
            title={storedWallet ? `Provider wallet: ${storedWallet}` : "Provider wallet"}
          >
            <Wallet className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {storedWallet
                ? `${storedWallet.slice(0, 6)}…${storedWallet.slice(-4)}`
                : "Wallet"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 hidden sm:block" />
          </Button>

          {showWalletMenu ? (
            <div className="absolute right-0 top-11 z-50 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-2">
              <div className="rounded-lg bg-surface px-3 py-3">
                <p className="text-sm font-medium text-foreground">Provider wallet</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {storedWallet ?? "No wallet linked yet"}
                </p>
              </div>
              <div className="mt-2 rounded-lg border border-border px-3 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Connected wallet
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {connectedWalletLabel ?? "Not connected"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Network: {currentNetworkLabel ?? "Not connected"}
                </p>
              </div>
              <div className="mt-2 rounded-lg border border-border px-3 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                  Supported networks
                </p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {SUPPORTED_WALLET_CHAIN_LABEL}
                </p>
              </div>
              {!isLinkedWalletConnected && linkedWalletLabel && hasConnectedWallet ? (
                <div className="mt-2 rounded-lg border border-border bg-secondary px-3 py-3 text-xs text-warning">
                  Connected wallet does not match {linkedWalletLabel}. Reconnect with the linked wallet for on-chain actions.
                </div>
              ) : null}
              {hasConnectedWallet && !isOnConfiguredNetwork ? (
                <div className="mt-2 rounded-lg border border-border bg-secondary px-3 py-3 text-xs text-warning">
                  Switch this wallet to {configuredChainLabel} before using dashboard transactions in the current workspace environment.
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
                {hasConnectedWallet && !isOnConfiguredNetwork ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => void switchToRequiredNetwork(configuredChainId)}
                    disabled={isSwitchingChain}
                  >
                    {isSwitchingChain
                      ? "Switching network..."
                      : `Switch to ${configuredChainLabel}`}
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
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
                >
                  <span>Manage wallet settings</span>
                  <span className="text-[11px] font-medium uppercase tracking-[0.1em]">
                    Settings
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Workspace switcher */}
        <div ref={workspaceRef} className="relative">
          <button
            type="button"
            onClick={() => setShowWorkspaceMenu((open) => !open)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-surface px-2 sm:px-3 text-xs font-medium text-foreground hover:bg-surface-raised transition-colors"
            title={sessionData?.currentTeam?.name ?? "Workspace"}
          >
            <Building2 className="h-4 w-4 sm:hidden text-muted-foreground" />
            <span className="max-w-[11rem] truncate hidden sm:inline">
              {sessionData?.currentTeam?.name ?? "Workspace"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground hidden sm:block" />
          </button>

          {showWorkspaceMenu && sessionData ? (
            <div className="absolute right-0 top-11 z-50 w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-2">
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
                    setShowWorkspaceMenu(false);
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
            </div>
          ) : null}
        </div>

        {/* Account menu */}
        <div ref={accountRef} className="relative">
          <button
            type="button"
            onClick={() => setShowAccountMenu((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-foreground overflow-hidden hover:bg-surface-raised transition-colors"
          >
            {sessionData?.user?.email ? (
              <img
                src={`https://api.dicebear.com/9.x/dylan/svg?seed=${encodeURIComponent(sessionData.user.email)}`}
                alt="avatar"
                className="h-full w-full"
              />
            ) : (
              <UserRound className="h-4 w-4" />
            )}
          </button>

          {showAccountMenu && sessionData ? (
            <div className="absolute right-0 top-11 z-50 w-[min(18rem,calc(100vw-1rem))] rounded-xl border border-border bg-popover p-2">
              <div className="flex items-center gap-3 rounded-lg bg-surface px-3 py-3">
                {sessionData.user.email && (
                  <img
                    src={`https://api.dicebear.com/9.x/dylan/svg?seed=${encodeURIComponent(sessionData.user.email)}`}
                    alt="avatar"
                    className="h-9 w-9 rounded-full border border-border bg-background shrink-0"
                  />
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {sessionData.currentTeam?.name ?? "ArcenPay"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {sessionData.user.email ?? "No email"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
                className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
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
