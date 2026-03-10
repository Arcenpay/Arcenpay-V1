"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useOrganization } from "@clerk/nextjs";
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
import { BillingSection } from "@/components/dashboard/sections/billing";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import { SubgraphLagBanner } from "@/components/dashboard/subgraph-lag-banner";
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
  | "billing"
  | "audit-log"
  | "settings";

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Read section from URL on mount
  useEffect(() => {
    const section = searchParams.get("section") as Section;
    if (section) {
      setActiveSection(section as Section);
    }
  }, [searchParams]);

  // Update URL when section changes
  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    router.push(`/?section=${section}`, { scroll: false });
  };

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
      case "billing":
        return (
          <SectionErrorBoundary fallbackLabel="Billing failed to load">
            <BillingSection />
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

  // Use org ID as key so the entire dashboard remounts when workspace switches,
  // forcing all data fetches to re-run against the new org context.
  const orgKey = organization?.id ?? "personal";

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
          <SubgraphLagBanner />
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
