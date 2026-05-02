"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { SubscribersSection } from "@/components/dashboard/sections/subscribers";
import { SessionsSection } from "@/components/dashboard/sections/sessions";
import { FeaturesSection } from "@/components/dashboard/sections/features";
import { SettingsSection } from "@/components/dashboard/sections/settings";
import { InvoicesSection } from "@/components/dashboard/sections/invoices";
import { AuditLogSection } from "@/components/dashboard/sections/audit-log";
import {
  CatalogPlansSection,
  CatalogAddOnsSection,
  CatalogCreditsSection,
  CatalogConfigSection,
} from "@/components/dashboard/sections/catalog";
import { ComponentsSection } from "@/components/dashboard/sections/components";
import { BillingSection } from "@/components/dashboard/sections/billing";
import { PaymentsSection } from "@/components/dashboard/sections/payments";
import { CompaniesSection } from "@/components/dashboard/sections/companies";
import { EventsStreamSection } from "@/components/dashboard/sections/events-stream";
import { FeatureFlagsSection } from "@/components/dashboard/sections/feature-flags";
import { AgentSection } from "@/components/dashboard/sections/agent";
import { WebhooksSection } from "@/components/dashboard/sections/webhooks";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";
import { SubgraphLagBanner } from "@/components/dashboard/subgraph-lag-banner";
import { EnvironmentProvider } from "@/contexts/environment-context";
import { DASHBOARD_DOCS_URL } from "@/lib/docs-url";

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
  | "payments"
  | "audit-log"
  | "settings"
  | "companies"
  | "events-stream"
  | "feature-flags"
  | "agent"
  | "webhooks";

const VALID_SECTIONS: Section[] = [
  "overview",
  "catalog-plans",
  "catalog-addons",
  "catalog-credits",
  "catalog-config",
  "subscribers",
  "invoices",
  "sessions",
  "features",
  "components",
  "billing",
  "payments",
  "audit-log",
  "settings",
  "companies",
  "events-stream",
  "feature-flags",
  "agent",
  "webhooks",
];

function isValidSection(section: string): section is Section {
  return VALID_SECTIONS.includes(section as Section);
}

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Read section from URL on mount
  useEffect(() => {
    const section = searchParams.get("section");
    if (section === "docs") {
      window.location.assign(DASHBOARD_DOCS_URL);
      return;
    }
    if (section && isValidSection(section)) {
      setActiveSection(section);
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
            <CatalogPlansSection />
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
            <ComponentsSection onSectionChange={handleSectionChange} />
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
      case "payments":
        return (
          <SectionErrorBoundary fallbackLabel="Payments failed to load">
            <PaymentsSection />
          </SectionErrorBoundary>
        );
      case "audit-log":
        return (
          <SectionErrorBoundary fallbackLabel="Audit Log failed to load">
            <AuditLogSection />
          </SectionErrorBoundary>
        );
      case "companies":
        return (
          <SectionErrorBoundary fallbackLabel="Companies failed to load">
            <CompaniesSection />
          </SectionErrorBoundary>
        );
      case "events-stream":
        return (
          <SectionErrorBoundary fallbackLabel="Events failed to load">
            <EventsStreamSection />
          </SectionErrorBoundary>
        );
      case "feature-flags":
        return (
          <SectionErrorBoundary fallbackLabel="Feature Flags failed to load">
            <FeatureFlagsSection />
          </SectionErrorBoundary>
        );
      case "agent":
        return (
          <SectionErrorBoundary fallbackLabel="Agent failed to load">
            <AgentSection />
          </SectionErrorBoundary>
        );
      case "webhooks":
        return (
          <SectionErrorBoundary fallbackLabel="Webhooks failed to load">
            <WebhooksSection />
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

  return (
    <EnvironmentProvider>
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
