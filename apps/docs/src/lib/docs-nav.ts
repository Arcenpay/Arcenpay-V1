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
      { label: "Platform Quickstart", href: "/quickstart", description: "Set up plans, access tokens, embeds, and live billing flows" },
      { label: "Architecture", href: "/architecture", description: "Understand dashboard, SDK, API, and chain responsibilities" },
      { label: "Webhooks", href: "/webhooks", description: "Sync subscriptions, invoices, and usage events" },
    ],
  },
  {
    id: "product-surfaces",
    label: "Product Surfaces",
    items: [
      { label: "Checkout Patterns", href: "/features/checkout", description: "Recurring subscriptions and hosted payment links" },
      { label: "Embedded Components", href: "/features/embedded-components", description: "ArcenEmbed, templates, and customer billing surfaces" },
      { label: "Customer Portal", href: "/features/customer-portal", description: "Self-serve billing, invoices, and subscription management" },
      { label: "Feature Flags", href: "/core-concepts/feature-flags", description: "Entitlements, metering, and gated product access" },
    ],
  },
  {
    id: "sdk-frameworks",
    label: "SDKs & Frameworks",
    items: [
      { label: "SDK Overview", href: "/sdk-reference", description: "Main React and Node integration path" },
      { label: "React SDK", href: "/sdk-reference/react", description: "Checkout, embeds, entitlement hooks, and UI surfaces" },
      { label: "Node.js SDK", href: "/sdk-reference/node", description: "Backend identify, billing, and webhook verification" },
      { label: "Agent SDK", href: "/sdk-reference/agent", description: "Optional autonomous x402 payment product surface" },
      { label: "Next.js Integration", href: "/frameworks/nextjs", description: "App router integration flow" },
      { label: "Express Integration", href: "/frameworks/express", description: "Server-side auth and webhook handling" },
    ],
  },
  {
    id: "api",
    label: "API Reference",
    items: [
      { label: "Authentication", href: "/api-reference/auth", description: "API keys and short-lived access tokens" },
      { label: "Plans API", href: "/api-reference/plans", description: "Create and publish catalog plans" },
      { label: "Subscriptions API", href: "/api-reference/subscriptions", description: "Verify and manage active billing state" },
      { label: "Sessions API", href: "/api-reference/sessions", description: "Session-based billing and usage verification" },
      { label: "Errors API", href: "/api-reference/errors", description: "Expected API and checkout failure responses" },
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
