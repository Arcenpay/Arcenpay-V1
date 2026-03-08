"use client";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/(dashboard)/page";
import { Bell, Search } from "lucide-react";
import { useState, useEffect } from "react";
import {
  useAppKit,
  useAppKitAccount,
  useAppKitNetwork,
} from "@reown/appkit/react";
import { UserButton, OrganizationSwitcher } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEnvironment } from "@/contexts/environment-context";

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
  features: "Features",
  components: "Components",
  "audit-log": "Audit Log",
  settings: "Settings",
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
  features: "Tableland + Lit Protocol feature flags",
  components: "UI component library",
  "audit-log": "Immutable record of all team actions",
  settings: "Provider configuration",
};

export function Header({ activeSection }: HeaderProps) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { open } = useAppKit();
  const { address } = useAppKitAccount();
  const { chainId } = useAppKitNetwork();
  const { envMode } = useEnvironment();

  useEffect(() => {
    setMounted(true);
  }, []);

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
        <button className="relative w-9 h-9 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200">
          <Bell className="w-5 h-5" />
        </button>

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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => open()}
          className="h-9 px-3 text-muted-foreground hover:text-foreground font-mono text-xs"
          title="Wallet"
        >
          {mounted && address
            ? `${address.slice(0, 6)}…${address.slice(-4)}`
            : "Connect"}
        </Button>

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
