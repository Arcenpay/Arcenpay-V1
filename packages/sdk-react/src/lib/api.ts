import type { EntitlementResult } from "@arcenpay/sdk";

/** 
 * Resolves the dashboard base URL.
 * 
 * Schematic-style: the publishableKey determines the routing.
 * In development, defaults to localhost:3000 (local dashboard).
 * In production, always uses https://dashboard.arcenpay.xyz.
 * Override with NEXT_PUBLIC_ARCENPAY_BASE_URL for staging environments.
 */
export function resolveDashboardBaseUrl(explicit?: string): string {
  if (explicit) return explicit.replace(/\/$/, "");
  // Read env override (for staging/custom deployments)
  const envOverride = typeof process !== "undefined"
    ? process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL
    : undefined;
  if (envOverride) return envOverride.replace(/\/$/, "");
  // Default: localhost in dev, production URL otherwise
  return typeof process !== "undefined" && process.env.NODE_ENV !== "production"
    ? "http://localhost:3000"
    : "https://dashboard.arcenpay.xyz";
}

export function resolveOptionalDashboardBaseUrl(
  explicit?: string,
): string | null {
  return explicit ? explicit.replace(/\/$/, "") : null;
}

export function resolveActivationEndpoint(explicit?: string): string | null {
  if (explicit) return explicit;
  const baseUrl = resolveOptionalDashboardBaseUrl();
  return baseUrl
    ? `${baseUrl.replace(/\/$/, "")}/api/v1/subscriptions/activate`
    : null;
}

export function createPaymentLinkCheckoutUrl(
  slug: string,
  baseUrl?: string,
): string {
  const resolvedBaseUrl = resolveDashboardBaseUrl(baseUrl);
  return `${resolvedBaseUrl.replace(/\/$/, "")}/pay/${encodeURIComponent(slug)}`;
}

export function mergeActivationHeaders(
  activationHeaders: Record<string, string> | undefined,
  token: string | null,
): Record<string, string> {
  const merged: Record<string, string> = {
    "Content-Type": "application/json",
    ...(activationHeaders ?? {}),
  };

  if (token && !merged.Authorization && !merged.authorization) {
    merged.Authorization = `Bearer ${token}`;
  }

  return merged;
}

export function entitlementsToFeatures(
  entitlements: Record<string, EntitlementResult>,
): Record<string, boolean | string | number> {
  return Object.fromEntries(
    Object.entries(entitlements).map(([key, entitlement]) => {
      if (entitlement.allocation !== null) {
        return [key, entitlement.allocation];
      }
      return [key, entitlement.enabled];
    }),
  );
}
