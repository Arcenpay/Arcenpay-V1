import type { EntitlementResult } from "../sdk";
import { resolveArcenPayAppUrl, resolveArcenPayBaseUrl } from "../sdk";

/**
 * Resolves the API base URL used by the React SDK.
 *
 * Defaults to the fixed SDK API URL.
 */
export function resolveDashboardBaseUrl(explicit?: string): string {
  return resolveArcenPayBaseUrl({ explicit });
}

export function resolveAppBaseUrl(explicit?: string): string {
  return resolveArcenPayAppUrl({ explicit });
}

export function resolveOptionalDashboardBaseUrl(
  explicit?: string,
): string | null {
  return explicit ? explicit.replace(/\/$/, "") : null;
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
