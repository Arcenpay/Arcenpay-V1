import type { EntitlementResult } from "../sdk";
import { resolveArcenPayBaseUrl } from "../sdk";

/**
 * Resolves the dashboard base URL.
 *
 * In development, defaults to localhost:3000.
 * In production, defaults to https://app.arcenpay.com.
 * Override with NEXT_PUBLIC_ARCENPAY_BASE_URL for staging environments.
 */
export function resolveDashboardBaseUrl(explicit?: string): string {
  return resolveArcenPayBaseUrl({ explicit });
}

export function resolveOptionalDashboardBaseUrl(
  explicit?: string,
): string | null {
  return explicit ? explicit.replace(/\/$/, "") : null;
}

export function createPaymentLinkCheckoutUrl(
  slug: string,
  baseUrl?: string,
): string {
  const resolvedBaseUrl = resolveDashboardBaseUrl(baseUrl);
  return `${resolvedBaseUrl.replace(/\/$/, "")}/pay/${encodeURIComponent(slug)}`;
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
