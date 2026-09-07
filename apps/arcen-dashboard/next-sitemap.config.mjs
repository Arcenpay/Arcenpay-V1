const PROD_FALLBACK_APP_URL = "https://app.arcenpay.com";
const DEV_FALLBACK_APP_URL = "http://localhost:3000";
const INDEXABLE_ROUTES = new Set(["/login"]);

function normalizeBaseUrl(value) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  return withProtocol.replace(/\/$/, "");
}

function isLocalhost(url) {
  return !url || url.includes("localhost") || url.includes("127.0.0.1");
}

const rawCandidate =
  normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
  normalizeBaseUrl(process.env.NEXTAUTH_URL) ||
  normalizeBaseUrl(process.env.VERCEL_URL);

const siteUrl = isLocalhost(rawCandidate) ? PROD_FALLBACK_APP_URL : rawCandidate;

/** @type {import("next-sitemap").IConfig} */
const config = {
  siteUrl,
  generateRobotsTxt: true,
  generateIndexSitemap: false,
  outDir: "public",
  exclude: [
    "/",
    "/api/*",
    "/invite",
    "/onboarding",
    "/onboarding/*",
    "/pay",
    "/pay/*",
    "/sso-callback",
    "/sign-in",
    "/sign-in/*",
    "/sign-up",
    "/sign-up/*",
  ],
  transform: async (currentConfig, path) => {
    if (!INDEXABLE_ROUTES.has(path)) {
      return null;
    }

    return {
      loc: path,
      changefreq: "weekly",
      priority: 0.4,
      lastmod: currentConfig.autoLastmod ? new Date().toISOString() : undefined,
    };
  },
  additionalPaths: async (currentConfig) => {
    const loginEntry = await currentConfig.transform(currentConfig, "/login");
    return loginEntry ? [loginEntry] : [];
  },
  robotsTxtOptions: {
    policies: [
      {
        userAgent: "*",
        allow: "/login",
        disallow: [
          "/",
          "/api/",
          "/invite",
          "/onboarding",
          "/pay",
          "/sign-in",
          "/sign-up",
          "/sso-callback",
        ],
      },
    ],
  },
};

export default config;
