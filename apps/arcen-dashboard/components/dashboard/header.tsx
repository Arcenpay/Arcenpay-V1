"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { Bell, Search, AlertTriangle, ExternalLink } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from "@reown/appkit/react";
import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
}

const sectionTitles: Record<Section, string> = {
  overview: "Overview",
  "catalog-plans": "Plans",
  "catalog-addons": "Add-Ons",
  "catalog-credits": "Credits",
  "catalog-config": "Configuration",
  subscribers: "Subscribers",
  invoices: "Invoices",
  sessions: "Sessions",
  features: "Entitlements",
  components: "Components",
  billing: "Billing & Plan",
  "audit-log": "Audit Log",
  settings: "Settings",
  docs: "Documentation",
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
  subscribers: "Track active subscribers",
  invoices: "Search, download, and resend invoices",
  sessions: "ZKVUB agent sessions",
  features: "On-chain entitlement flags per subscription tier",
  components: "UI component library",
  billing: "Manage your platform tier, gas budget, and support",
  "audit-log": "Immutable record of all team actions",
  settings: "Provider configuration",
  docs: "Platform guides, SDK reference, and contract addresses",
  companies: "Manage companies, entitlements, and overrides",
  "events-stream": "Live stream of track and identify events",
  "feature-flags": "Manage flags, targeting rules, and zkTLS conditions",
  agent: "AI agent SDK, API keys, and session management",
  webhooks: "Configure endpoints, signing secrets, and delivery logs",
};

export function Header({ activeSection }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { open } = useAppKit();
  const { address } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { envMode } = useEnvironment();

  // Wallet mismatch detection
  const [storedWallet, setStoredWallet] = useState<string | null>(null);
  const walletMismatch =
    mounted &&
    !!storedWallet &&
    !!address &&
    storedWallet.toLowerCase() !== address.toLowerCase();

  // Notification bell state
  const [showNotifications, setShowNotifications] = useState(false);
  const [auditEvents, setAuditEvents] = useState<AuditEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch stored wallet
  useEffect(() => {
    fetch("/api/auth/wallet-status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.storedWallet) setStoredWallet(d.storedWallet);
      })
      .catch(() => {});
  }, []);

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
    }
    if (showNotifications) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [showNotifications]);

  const markAllRead = useCallback(() => {
    localStorage.setItem("arcen_notif_last_viewed", new Date().toISOString());
    setUnreadCount(0);
  }, []);

  const formatAction = (action: string) =>
    action.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

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
            mounted && envMode === "PRODUCTION"
              ? "border-orange-400/50 text-orange-400 bg-orange-400/5"
              : "border-blue-400/50 text-blue-400 bg-blue-400/5",
          )}
        >
          {mounted && envMode === "PRODUCTION" ? "Mainnet" : "Testnet"}
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

        {/* Network Switcher */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open({ view: "Networks" })}
          className="h-9 px-3 text-muted-foreground hover:text-foreground"
          title="Switch network"
        >
          {mounted && chainId ? `Chain ${chainId}` : "Network"}
        </Button>

        {/* Wallet button */}
        <div className="flex items-center gap-1">
          {walletMismatch && (
            <span
              className="flex items-center gap-1 text-amber-400"
              title={`Connected wallet differs from your provider wallet (${storedWallet!.slice(0, 6)}…${storedWallet!.slice(-4)}). On-chain operations require your provider wallet.`}
            >
              <AlertTriangle className="w-4 h-4" />
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => open()}
            className={cn(
              "h-9 px-3 font-mono text-xs",
              walletMismatch
                ? "text-amber-400 hover:text-amber-300"
                : "text-muted-foreground hover:text-foreground",
            )}
            title={
              walletMismatch
                ? `Mismatch! Provider wallet: ${storedWallet!.slice(0, 6)}…${storedWallet!.slice(-4)}`
                : mounted && storedWallet && !address
                  ? `Provider wallet: ${storedWallet.slice(0, 6)}…${storedWallet.slice(-4)} (not connected)`
                  : "Wallet"
            }
          >
            {mounted && address
              ? `${address.slice(0, 6)}…${address.slice(-4)}`
              : mounted && storedWallet
                ? `${storedWallet.slice(0, 6)}…${storedWallet.slice(-4)}`
                : "Connect"}
          </Button>
        </div>

        {/* Team / Org switcher */}
        <OrganizationSwitcher
          hidePersonal
          afterSelectOrganizationUrl="/"
          afterCreateOrganizationUrl="/"
          appearance={{
            elements: {
              rootBox: "flex items-center",
              organizationSwitcherTrigger:
                "h-9 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-secondary border-0 focus:ring-0",
            },
          }}
        />

        {/* User account + sign out */}
        <UserButton />
      </div>
    </header>
  );
}
