import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.arcenpay.xyz";

  const pages = [
    { path: "", priority: 1 },
    { path: "/quickstart", priority: 0.9 },
    { path: "/features/checkout", priority: 0.9 },
    { path: "/features/customer-portal", priority: 0.8 },
    { path: "/webhooks", priority: 0.8 },
    { path: "/sdk-reference", priority: 0.9 },
    { path: "/sdk-reference/react", priority: 0.9 },
    { path: "/sdk-reference/node", priority: 0.9 },
    { path: "/sdk-reference/agent", priority: 0.6 },
    { path: "/frameworks/nextjs", priority: 0.8 },
    { path: "/frameworks/express", priority: 0.8 },
    { path: "/api-reference/auth", priority: 0.8 },
    { path: "/api-reference/plans", priority: 0.8 },
    { path: "/api-reference/subscriptions", priority: 0.8 },
    { path: "/api-reference/errors", priority: 0.7 },
    { path: "/core-concepts/plans", priority: 0.8 },
    { path: "/core-concepts/subscriptions", priority: 0.8 },
    { path: "/core-concepts/feature-flags", priority: 0.8 },
    { path: "/core-concepts/sessions", priority: 0.6 },
    { path: "/core-concepts/cross-chain", priority: 0.6 },
    { path: "/core-concepts/billing-fees", priority: 0.6 },
    { path: "/guides/subscription-wall", priority: 0.7 },
    { path: "/guides/feature-gating", priority: 0.7 },
    { path: "/guides/migrate-from-stripe", priority: 0.7 },
    { path: "/guides/ai-agent-payments", priority: 0.6 },
    { path: "/changelog", priority: 0.6 },
    { path: "/support", priority: 0.6 },
  ];

  return pages.map(({ path, priority }) => ({
    url: `${baseUrl}${path}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority,
  }));
}
