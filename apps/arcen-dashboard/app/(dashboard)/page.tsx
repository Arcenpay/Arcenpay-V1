"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization, useOrganizationList } from "@clerk/nextjs";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { PlansSection } from "@/components/dashboard/sections/plans";
import { SubscribersSection } from "@/components/dashboard/sections/subscribers";
import { SessionsSection } from "@/components/dashboard/sections/sessions";
import { FeaturesSection } from "@/components/dashboard/sections/features";
import { SettingsSection } from "@/components/dashboard/sections/settings";
import { InvoicesSection } from "@/components/dashboard/sections/invoices";
import { AuditLogSection } from "@/components/dashboard/sections/audit-log";
import {
  CatalogAddOnsSection,
  CatalogCreditsSection,
  CatalogConfigSection,
} from "@/components/dashboard/sections/catalog";
import { ComponentsSection } from "@/components/dashboard/sections/components";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import { EnvironmentProvider } from "@/contexts/environment-context";

export type Section =
  | "overview"
  | "catalog-plans"
  | "catalog-addons"
  | "catalog-credits"
  | "catalog-config"
  | "subscribers"
  | "invoices"
  | "sessions"
  | "features"
  | "components"
  | "audit-log"
  | "settings";

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization, isLoaded: orgLoaded } = useOrganization();
  const { isLoaded: listLoaded } = useOrganizationList({
    userMemberships: { infinite: false },
  });
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Read section from URL on mount
  useEffect(() => {
    const section = searchParams.get("section") as Section;
    if (section) {
      setActiveSection(section);
    }
  }, [searchParams]);

  // Update URL when section changes
  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    router.push(`/?section=${section}`, { scroll: false });
  };

  // ── Org loading / pending state ──────────────────────────────────────────
  // orgLoaded: false  →  Clerk is still initialising (show spinner)
  // orgLoaded: true, organization: null  →  org exists in DB but hasn't synced
  //   to Clerk's client session yet (webhook race).  Auto-refresh will resolve.
  if (!orgLoaded || !listLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-10 h-10 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
          <h2 className="text-lg font-semibold text-foreground">
            Loading your workspace…
          </h2>
          <p className="text-sm text-muted-foreground">
            Just a moment while we set up your workspace.
          </p>
          <button
            onClick={() => router.refresh()}
            className="text-sm text-accent hover:underline"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return (
          <SectionErrorBoundary fallbackLabel="Overview failed to load">
            <OverviewSection />
          </SectionErrorBoundary>
        );
      case "catalog-plans":
        return (
          <SectionErrorBoundary fallbackLabel="Plans failed to load">
            <PlansSection />
          </SectionErrorBoundary>
        );
      case "catalog-addons":
        return (
          <SectionErrorBoundary fallbackLabel="Add-Ons failed to load">
            <CatalogAddOnsSection />
          </SectionErrorBoundary>
        );
      case "catalog-credits":
        return (
          <SectionErrorBoundary fallbackLabel="Credits failed to load">
            <CatalogCreditsSection />
          </SectionErrorBoundary>
        );
      case "catalog-config":
        return (
          <SectionErrorBoundary fallbackLabel="Configuration failed to load">
            <CatalogConfigSection />
          </SectionErrorBoundary>
        );
      case "subscribers":
        return (
          <SectionErrorBoundary fallbackLabel="Subscribers failed to load">
            <SubscribersSection />
          </SectionErrorBoundary>
        );
      case "invoices":
        return (
          <SectionErrorBoundary fallbackLabel="Invoices failed to load">
            <InvoicesSection />
          </SectionErrorBoundary>
        );
      case "sessions":
        return (
          <SectionErrorBoundary fallbackLabel="Sessions failed to load">
            <SessionsSection />
          </SectionErrorBoundary>
        );
      case "features":
        return (
          <SectionErrorBoundary fallbackLabel="Features failed to load">
            <FeaturesSection />
          </SectionErrorBoundary>
        );
      case "components":
        return (
          <SectionErrorBoundary fallbackLabel="Components failed to load">
            <ComponentsSection />
          </SectionErrorBoundary>
        );
      case "settings":
        return (
          <SectionErrorBoundary fallbackLabel="Settings failed to load">
            <SettingsSection />
          </SectionErrorBoundary>
        );
      case "audit-log":
        return (
          <SectionErrorBoundary fallbackLabel="Audit Log failed to load">
            <AuditLogSection />
          </SectionErrorBoundary>
        );
      default:
        return (
          <SectionErrorBoundary>
            <OverviewSection />
          </SectionErrorBoundary>
        );
    }
  };

  // organization is guaranteed non-null by the guard above
  const orgKey = organization.id;

  return (
    <EnvironmentProvider key={orgKey}>
      <div className="flex min-h-screen bg-background">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
        <div
          className={`flex-1 flex flex-col transition-all duration-300 ease-out ${
            sidebarCollapsed ? "ml-[64px]" : "ml-[220px]"
          }`}
        >
          <Header activeSection={activeSection} />
          <main className="flex-1 p-6 overflow-auto">
            <div
              key={activeSection}
              className="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              {renderSection()}
            </div>
          </main>
        </div>
      </div>
    </EnvironmentProvider>
  );
}
