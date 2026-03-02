"use client";

import { useState } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Header } from "@/components/dashboard/header";
import { OverviewSection } from "@/components/dashboard/sections/overview";
import { PlansSection } from "@/components/dashboard/sections/plans";
import { SubscribersSection } from "@/components/dashboard/sections/subscribers";
import { SessionsSection } from "@/components/dashboard/sections/sessions";
import { FeaturesSection } from "@/components/dashboard/sections/features";
import { SettingsSection } from "@/components/dashboard/sections/settings";
import { SectionErrorBoundary } from "@/components/dashboard/section-error-boundary";

export type Section = "overview" | "plans" | "subscribers" | "sessions" | "features" | "settings";

export default function Dashboard() {
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return <SectionErrorBoundary fallbackLabel="Overview failed to load"><OverviewSection /></SectionErrorBoundary>;
      case "plans":
        return <SectionErrorBoundary fallbackLabel="Plans failed to load"><PlansSection /></SectionErrorBoundary>;
      case "subscribers":
        return <SectionErrorBoundary fallbackLabel="Subscribers failed to load"><SubscribersSection /></SectionErrorBoundary>;
      case "sessions":
        return <SectionErrorBoundary fallbackLabel="Sessions failed to load"><SessionsSection /></SectionErrorBoundary>;
      case "features":
        return <SectionErrorBoundary fallbackLabel="Features failed to load"><FeaturesSection /></SectionErrorBoundary>;
      case "settings":
        return <SectionErrorBoundary fallbackLabel="Settings failed to load"><SettingsSection /></SectionErrorBoundary>;
      default:
        return <SectionErrorBoundary><OverviewSection /></SectionErrorBoundary>;
    }
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
      />
      <div
        className={`flex-1 flex flex-col transition-all duration-300 ease-out ${sidebarCollapsed ? "ml-[72px]" : "ml-[260px]"
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
  );
}
