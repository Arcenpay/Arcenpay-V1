export type DocsNavItem = {
  label: string;
  href: string;
  description?: string;
  external?: boolean;
};

export type DocsNavGroup = {
  id: string;
  label: string;
  items: DocsNavItem[];
};

export const DOCS_NAV_GROUPS: DocsNavGroup[] = [
  {
    id: "start-here",
    label: "Start Here",
    items: [
      { label: "Introduction", href: "/", description: "Product overview and docs map" },
      { label: "Platform Quickstart", href: "/quickstart", description: "Set up the dashboard, React provider, and backend billing flows" },
      { label: "Architecture", href: "/architecture", description: "See how the dashboard, SDKs, APIs, and chain runtime fit together" },
      { label: "Webhooks", href: "/webhooks", description: "Sync companies, subscriptions, invoices, and payment events" },
    ],
  },
  {
    id: "product-surfaces",
    label: "Product Surfaces",
    items: [
      { label: "Checkout Patterns", href: "/features/checkout", description: "Embedded recurring checkout and hosted one-time payment links" },
      { label: "Embedded Components", href: "/features/embedded-components", description: "ArcenEmbed, dashboard components, and published billing UIs" },
      { label: "Customer Portal", href: "/features/customer-portal", description: "Self-serve plans, invoices, payment state, and usage views" },
      { label: "Feature Flags", href: "/core-concepts/feature-flags", description: "Flags, entitlements, usage consumption, and gated access" },
    ],
  },
  {
    id: "sdk-frameworks",
    label: "SDKs & Frameworks",
    items: [
      { label: "SDK Overview", href: "/sdk-reference", description: "Choose the React, Node, agent, or low-level SDK path" },
      { label: "React SDK", href: "/sdk-reference/react", description: "Provider setup, identify, embeds, hooks, and payment-link helpers" },
      { label: "Node.js SDK", href: "/sdk-reference/node", description: "Access tokens, company APIs, subscription activation, and webhooks" },
      { label: "Agent SDK", href: "/sdk-reference/agent", description: "Optional x402-style autonomous payment flows for agents and bots" },
      { label: "Next.js Integration", href: "/frameworks/nextjs", description: "App Router setup with React SDK and server routes" },
      { label: "Express Integration", href: "/frameworks/express", description: "Server-side entitlement checks and webhook handling" },
    ],
  },
  {
    id: "api",
    label: "API Reference",
    items: [
      { label: "Authentication", href: "/api-reference/auth", description: "API keys, publishable keys, and short-lived access tokens" },
      { label: "Catalog & Checkout", href: "/api-reference/plans", description: "Components, payment links, checkout sessions, and catalog-facing APIs" },
      { label: "Billing & Subscriptions", href: "/api-reference/subscriptions", description: "Access checks, usage consumption, activation, and plan actions" },
      { label: "Errors API", href: "/api-reference/errors", description: "Common HTTP failures, webhook verification, and SDK error handling" },
    ],
  },
  {
    id: "guides",
    label: "Guides",
    items: [
      { label: "SaaS Subscription Wall", href: "/guides/subscription-wall" },
      { label: "Feature Gating", href: "/guides/feature-gating" },
      { label: "AI Agent Payments", href: "/guides/ai-agent-payments" },
      { label: "Migrate from Stripe", href: "/guides/migrate-from-stripe" },
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

export const TOP_LEVEL_DOCS_LINKS = [
  { label: "Docs", href: "/" },
  { label: "SDKs", href: "/sdk-reference" },
  { label: "API Reference", href: "/api-reference/auth" },
  { label: "Support", href: "/support" },
];

export const ALL_DOCS_NAV_ITEMS = DOCS_NAV_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, groupLabel: group.label })),
);
