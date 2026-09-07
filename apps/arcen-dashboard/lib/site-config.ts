const PROD_FALLBACK_APP_URL = "https://app.arcenpay.com";
const DEV_FALLBACK_APP_URL = "http://localhost:3000";

function normalizeBaseUrl(value?: string | null): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const withProtocol =
    trimmed.startsWith("http://") || trimmed.startsWith("https://")
      ? trimmed
      : `https://${trimmed}`;

  return withProtocol.replace(/\/$/, "");
}

function resolveDashboardAppUrl(): string {
  const configured =
    normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeBaseUrl(process.env.NEXTAUTH_URL) ||
    normalizeBaseUrl(process.env.VERCEL_URL);

  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV === "production"
    ? PROD_FALLBACK_APP_URL
    : DEV_FALLBACK_APP_URL;
}

export const DASHBOARD_APP_URL = resolveDashboardAppUrl();
export const DASHBOARD_SITE_NAME = "ArcenPay Dashboard";
export const DASHBOARD_DESCRIPTION =
  "Manage subscriptions, invoices, environments, and protocol analytics from the ArcenPay provider dashboard.";
export const DASHBOARD_OG_IMAGE_PATH = "/arcenpay-logo.png";
export const DASHBOARD_KEYWORDS = [
  "ArcenPay",
  "subscription billing",
  "provider dashboard",
  "invoice management",
  "protocol analytics",
  "web3 billing",
];

export function absoluteSiteUrl(path = "/"): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${DASHBOARD_APP_URL}${normalizedPath}`;
}
