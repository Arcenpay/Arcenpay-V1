"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3000";

type NavItem = {
  label: string;
  href: string;
  description?: string;
  icon?: React.ReactNode;
  external?: boolean;
};

type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "start-here",
    label: "Start Here",
    items: [
      {
        label: "Introduction",
        href: "/",
        description: "Conceptual overview and docs map",
      },
      { label: "Base Sepolia Quickstart", href: "/quickstart" },
      { label: "Architecture", href: "/architecture" },
      { label: "Migrate from Stripe", href: "/guides/migrate-from-stripe" },
      { label: "Migration Playbook", href: "/migration" },
    ],
  },
  {
    id: "build",
    label: "Build",
    items: [
      { label: "Plan Modeling", href: "/core-concepts/plans" },
      { label: "Subscription Lifecycle", href: "/core-concepts/subscriptions" },
      { label: "Feature Flags", href: "/core-concepts/feature-flags" },
      { label: "Checkout and Hosted Payments", href: "/features/checkout" },
      { label: "Customer Portal", href: "/features/customer-portal" },
      { label: "Webhooks", href: "/webhooks" },
    ],
  },
  {
    id: "usage-ai",
    label: "Usage and AI Billing",
    items: [
      { label: "Sessions and Gas (ZKVUB)", href: "/core-concepts/sessions" },
      { label: "Billing and Fees", href: "/core-concepts/billing-fees" },
      { label: "Cross-chain Mirroring", href: "/core-concepts/cross-chain" },
      { label: "AI Agent Payments", href: "/guides/ai-agent-payments" },
    ],
  },
  {
    id: "sdk-frameworks",
    label: "SDKs and Frameworks",
    items: [
      { label: "SDKs Overview", href: "/sdk-reference" },
      { label: "React SDK", href: "/sdk-reference/react" },
      { label: "Node.js SDK", href: "/sdk-reference/node" },
      { label: "Agent SDK", href: "/sdk-reference/agent" },
      { label: "Next.js Integration", href: "/frameworks/nextjs" },
      { label: "Express Integration", href: "/frameworks/express" },
    ],
  },
  {
    id: "api",
    label: "API Reference",
    items: [
      { label: "Authentication", href: "/api-reference/auth" },
      { label: "Plans API", href: "/api-reference/plans" },
      { label: "Subscriptions API", href: "/api-reference/subscriptions" },
      { label: "Sessions API", href: "/api-reference/sessions" },
      { label: "Errors API", href: "/api-reference/errors" },
    ],
  },
  {
    id: "contracts",
    label: "Contracts",
    items: [
      { label: "Contract Overview", href: "/contracts" },
      { label: "PlanFactory", href: "/contracts/plan-factory" },
      {
        label: "SubscriptionRegistry",
        href: "/contracts/subscription-registry",
      },
      { label: "ERC7579AutopayModule", href: "/contracts/autopay-module" },
      { label: "SessionVault", href: "/contracts/session-vault" },
      { label: "ZKUsageVerifier", href: "/contracts/zk-usage-verifier" },
      { label: "FeeCollector", href: "/contracts/fee-collector" },
    ],
  },
  {
    id: "guides",
    label: "Implementation Guides",
    items: [
      { label: "SaaS Subscription Wall", href: "/guides/subscription-wall" },
      { label: "Feature Gating", href: "/guides/feature-gating" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      { label: "Contract Addresses", href: "/contract-addresses" },
      { label: "Changelog", href: "/changelog" },
      { label: "Support", href: "/support" },
    ],
  },
];

const TOP_LEVEL_LINKS = [
  { label: "Docs", href: "/" },
  { label: "API Reference", href: "/api-reference/auth" },
  { label: "Guides", href: "/guides/subscription-wall" },
];

function isItemActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function prettifyPathname(pathname: string) {
  if (pathname === "/") return "Introduction";
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    );
  return segments.join(" / ");
}

function ChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function Sidebar({
  pathname,
  mobileOpen,
  onClose,
}: {
  pathname: string;
  mobileOpen: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return NAV_GROUPS;

    return NAV_GROUPS.map((group) => {
      const groupMatches = group.label.toLowerCase().includes(normalizedQuery);
      if (groupMatches) return group;
      return {
        ...group,
        items: group.items.filter((item) => {
          const target =
            `${item.label} ${item.description ?? ""}`.toLowerCase();
          return target.includes(normalizedQuery);
        }),
      };
    }).filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  const toggle = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <>
      <button
        className={`docs-mobile-overlay${mobileOpen ? " open" : ""}`}
        onClick={onClose}
        aria-label="Close documentation navigation"
      />

      <aside className={`docs-sidebar${mobileOpen ? " open" : ""}`}>
        {/* Brand */}
        <div className="docs-brand">
          <div className="docs-sidebar-header-row">
            <div className="docs-brand-logo">
              <svg
                width="26"
                height="26"
                viewBox="0 0 512 512"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect width="512" height="512" fill="#0f3ea8" rx="100" />
                <polygon
                  points="214,142 284,142 414,414 344,414"
                  fill="#ffffff"
                />
                <circle cx="230" cy="265" r="45" fill="#5c84db" />
                <circle cx="170" cy="350" r="50" fill="#ffffff" />
              </svg>
            </div>
            <span className="docs-brand-name">ArcenPay Docs</span>
            <span className="docs-version-badge">Live</span>
            <button
              className="docs-sidebar-close"
              onClick={onClose}
              aria-label="Close navigation"
            >
              ×
            </button>
          </div>

          <div className="docs-nav-search-wrap">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search docs"
              className="docs-nav-search"
              aria-label="Search documentation"
            />
          </div>
        </div>

        <div className="docs-sidebar-inner">
          {/* Back to dashboard */}
          <a
            href={DASHBOARD_URL}
            className="docs-sidebar-utility"
            onClick={onClose}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            Open Workspace
          </a>

          <div className="docs-nav-divider" />

          {filteredGroups.length === 0 ? (
            <div className="docs-nav-empty">No matching docs pages.</div>
          ) : (
            filteredGroups.map((group) => {
              const isCollapsed = normalizedQuery
                ? false
                : (collapsed[group.id] ?? false);
              return (
                <div key={group.id} className="docs-nav-group">
                  {/* Collapsible group header */}
                  <button
                    className="docs-nav-group-header"
                    onClick={() => {
                      if (!normalizedQuery) toggle(group.id);
                    }}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="docs-nav-group-label">{group.label}</span>
                    <span
                      className={`docs-nav-group-chevron${isCollapsed ? " collapsed" : ""}`}
                    >
                      <ChevronDown />
                    </span>
                  </button>

                  {/* Items */}
                  <div
                    className={`docs-nav-items${isCollapsed ? " collapsed" : ""}`}
                    style={{ maxHeight: isCollapsed ? 0 : "500px" }}
                  >
                    {group.items.map((item) => {
                      const isActive = isItemActive(pathname, item.href);
                      return (
                        <a
                          key={item.href}
                          href={item.href}
                          className={`docs-nav-link${isActive ? " active" : ""}`}
                          target={item.external ? "_blank" : undefined}
                          rel={
                            item.external ? "noopener noreferrer" : undefined
                          }
                          onClick={onClose}
                          title={item.description}
                        >
                          {item.icon && (
                            <span className="docs-nav-link-icon">
                              {item.icon}
                            </span>
                          )}
                          {item.label}
                          {item.external && (
                            <span className="docs-nav-external">
                              <ExternalIcon />
                            </span>
                          )}
                        </a>
                      );
                    })}
                  </div>

                  <div className="docs-nav-divider" />
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}

export default function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="docs-shell">
      <Sidebar
        pathname={pathname}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="docs-main">
        {/* Topbar */}
        <div className="docs-topbar">
          <button
            className="docs-mobile-nav-toggle"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open documentation navigation"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>

          <div className="docs-topbar-breadcrumb">
            <span>Docs</span>
            <span className="docs-topbar-breadcrumb-sep">/</span>
            <span className="docs-topbar-breadcrumb-current">
              {prettifyPathname(pathname)}
            </span>
          </div>

          <div className="docs-topbar-tabs">
            {TOP_LEVEL_LINKS.map((link) => {
              const active = isItemActive(pathname, link.href);
              return (
                <a
                  key={link.href}
                  href={link.href}
                  className={`docs-topbar-tab${active ? " active" : ""}`}
                >
                  {link.label}
                </a>
              );
            })}
          </div>

          <div className="docs-topbar-right">
            <span className="docs-topbar-badge">
              <span className="docs-topbar-badge-dot" />
              Payments + Billing
            </span>
            <a href={DASHBOARD_URL} className="docs-topbar-btn">
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Workspace
            </a>
          </div>
        </div>

        {/* Page body */}
        <div className="docs-body">{children}</div>
      </div>
    </div>
  );
}
