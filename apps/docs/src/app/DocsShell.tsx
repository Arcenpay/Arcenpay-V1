'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL ?? 'http://localhost:3000';

type NavItem = {
  label: string;
  href: string;
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
    id: 'introduction',
    label: 'INTRODUCTION',
    items: [
      { label: 'Overview', href: '/' },
      { label: 'Quickstart', href: '/quickstart' },
      { label: 'Architecture', href: '/architecture' },
      { label: 'Migration Guide', href: '/migration' },
    ],
  },
  {
    id: 'core-features',
    label: 'CORE FEATURES',
    items: [
      { label: 'Plans', href: '/core-concepts/plans' },
      { label: 'Subscriptions', href: '/core-concepts/subscriptions' },
      { label: 'Sessions & Gas (ZKVUB)', href: '/core-concepts/sessions' },
      { label: 'Feature Flags', href: '/core-concepts/feature-flags' },
      { label: 'Billing & Fees', href: '/core-concepts/billing-fees' },
      { label: 'Cross-Chain', href: '/core-concepts/cross-chain' },
      { label: 'Checkout & Modals', href: '/features/checkout' },
      { label: 'Customer Portal', href: '/features/customer-portal' },
    ],
  },
  {
    id: 'integrate',
    label: 'INTEGRATE',
    items: [
      { label: 'SDKs Overview', href: '/sdk-reference' },
      { label: 'React SDK', href: '/sdk-reference/react' },
      { label: 'Node.js SDK', href: '/sdk-reference/node' },
      { label: 'Agent SDK', href: '/sdk-reference/agent' },
      { label: 'Next.js Framework', href: '/frameworks/nextjs' },
      { label: 'Express Framework', href: '/frameworks/express' },
      { label: 'Webhooks', href: '/webhooks' },
    ],
  },
  {
    id: 'contract-reference',
    label: 'CONTRACT REFERENCE',
    items: [
      { label: 'Overview', href: '/contracts' },
      { label: 'PlanFactory', href: '/contracts/plan-factory' },
      { label: 'SubscriptionRegistry', href: '/contracts/subscription-registry' },
      { label: 'ERC7579AutopayModule', href: '/contracts/autopay-module' },
      { label: 'SessionVault', href: '/contracts/session-vault' },
      { label: 'ZKUsageVerifier', href: '/contracts/zk-usage-verifier' },
      { label: 'FeeCollector', href: '/contracts/fee-collector' },
      { label: 'MirrorRegistry', href: '/contracts/mirror-registry' },
    ],
  },
  {
    id: 'api-reference',
    label: 'API REFERENCE',
    items: [
      { label: 'Authentication', href: '/api-reference/auth' },
      { label: 'Plans API', href: '/api-reference/plans' },
      { label: 'Subscriptions API', href: '/api-reference/subscriptions' },
      { label: 'Sessions API', href: '/api-reference/sessions' },
      { label: 'Error Codes', href: '/api-reference/errors' },
    ],
  },
  {
    id: 'guides',
    label: 'GUIDES',
    items: [
      { label: 'SaaS Subscription Wall', href: '/guides/subscription-wall' },
      { label: 'AI Agent Micropayments', href: '/guides/ai-agent-payments' },
      { label: 'Feature Gating', href: '/guides/feature-gating' },
      { label: 'Stripe Migration', href: '/guides/migrate-from-stripe' },
    ],
  },
  {
    id: 'resources',
    label: 'RESOURCES',
    items: [
      { label: 'Contract Addresses', href: '/contract-addresses' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Support', href: '/support' },
      {
        label: 'GitHub Repository',
        href: 'https://github.com/arcenpay/arcenpay',
        external: true,
        icon: (
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: 'inherit' }}>&gt;_</span>
        ),
      },
    ],
  },
];

function ChevronDown({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <aside className="docs-sidebar">
      {/* Brand */}
      <div className="docs-brand">
        <div className="docs-brand-logo">
          <svg width="26" height="26" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect width="512" height="512" fill="#4f46e5" rx="100" />
            <polygon points="214,142 284,142 414,414 344,414" fill="#ffffff" />
            <circle cx="230" cy="265" r="45" fill="#818cf8" />
            <circle cx="170" cy="350" r="50" fill="#ffffff" />
          </svg>
        </div>
        <span className="docs-brand-name">ArcenPay Docs</span>
        <span className="docs-version-badge">v1.0</span>
      </div>

      <div className="docs-sidebar-inner">
        {/* Back to dashboard */}
        <a
          href={DASHBOARD_URL}
          className="docs-nav-link"
          style={{ marginBottom: '8px', fontSize: '12.5px', color: '#9ca3af' }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back to Dashboard
        </a>

        <div className="docs-nav-divider" />

        {NAV_GROUPS.map((group) => {
          const isCollapsed = collapsed[group.id] ?? false;
          return (
            <div key={group.id} className="docs-nav-group">
              {/* Collapsible group header */}
              <button
                className="docs-nav-group-header"
                onClick={() => toggle(group.id)}
                aria-expanded={!isCollapsed}
              >
                <span className="docs-nav-group-label">{group.label}</span>
                <span className={`docs-nav-group-chevron${isCollapsed ? ' collapsed' : ''}`}>
                  <ChevronDown />
                </span>
              </button>

              {/* Items */}
              <div
                className={`docs-nav-items${isCollapsed ? ' collapsed' : ''}`}
                style={{ maxHeight: isCollapsed ? 0 : '500px' }}
              >
                {group.items.map((item) => {
                  const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      className={`docs-nav-link${isActive ? ' active' : ''}`}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                    >
                      {item.icon && <span className="docs-nav-link-icon">{item.icon}</span>}
                      {item.label}
                      {item.external && (
                        <span className="docs-nav-external"><ExternalIcon /></span>
                      )}
                    </a>
                  );
                })}
              </div>

              <div className="docs-nav-divider" />
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default function DocsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="docs-shell">
      <Sidebar pathname={pathname} />

      <div className="docs-main">
        {/* Topbar */}
        <div className="docs-topbar">
          <div className="docs-topbar-breadcrumb">
            <span>Docs</span>
            <span className="docs-topbar-breadcrumb-sep">/</span>
            <span className="docs-topbar-breadcrumb-current">ArcenPay</span>
          </div>
          <div className="docs-topbar-right">
            <span className="docs-topbar-badge">
              <span className="docs-topbar-badge-dot" />
              Testnet Live
            </span>
            <a href={DASHBOARD_URL} className="docs-topbar-btn">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 18-6-6 6-6" />
              </svg>
              Dashboard
            </a>
          </div>
        </div>

        {/* Page body */}
        <div className="docs-body">
          {children}
        </div>
      </div>
    </div>
  );
}
