import type { EntitlementResult } from "@arcenpay/sdk";

function readEnv(key: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[key];
}

export function resolveDashboardBaseUrl(explicit?: string): string {
  return (
    explicit ??
    readEnv("NEXT_PUBLIC_ARCEN_BASE_URL") ??
    readEnv("NEXT_PUBLIC_ARCENPAY_BASE_URL") ??
    "https://dashboard.arcenpay.xyz"
  );
}

export function resolveOptionalDashboardBaseUrl(explicit?: string): string | null {
  return (
    explicit ??
    readEnv("NEXT_PUBLIC_ARCEN_BASE_URL") ??
    readEnv("NEXT_PUBLIC_ARCENPAY_BASE_URL") ??
    null
  );
}

export function resolveActivationEndpoint(explicit?: string): string | null {
  if (explicit) return explicit;
  const baseUrl = resolveOptionalDashboardBaseUrl();
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/v1/subscriptions/activate` : null;
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
