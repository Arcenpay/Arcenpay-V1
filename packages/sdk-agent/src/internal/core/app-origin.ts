export const ARCENPAY_API_URL = "https://api.arcenpay.com";
export const ARCENPAY_APP_URL = "https://app.arcenpay.com";

declare global {
  // eslint-disable-next-line no-var
  var __ARCENPAY_API_URL__: string | undefined;
  // eslint-disable-next-line no-var
  var __ARCENPAY_APP_URL__: string | undefined;
}

/**
 * Runtime override for the SDK's backend URL. The published bundle must not
 * read process.env, but a host app may still need to point the SDK at a
 * local/staging backend. Set the global before the first SDK call:
 *   globalThis.__ARCENPAY_API_URL__ = "http://localhost:3300";
 */
function readRuntimeOverride(key: "api" | "app"): string | undefined {
  try {
    const g = globalThis as unknown as Record<string, unknown>;
    const value = key === "api" ? g.__ARCENPAY_API_URL__ : g.__ARCENPAY_APP_URL__;
    if (typeof value === "string" && value.trim()) return value.trim();
  } catch {
    // ignore
  }
  return undefined;
}

export interface ResolveArcenPayBaseUrlOptions {
  explicit?: string;
}

export interface ResolveArcenPayAppUrlOptions {
  explicit?: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function resolveArcenPayBaseUrl(
  options: ResolveArcenPayBaseUrlOptions = {},
): string {
  if (options.explicit?.trim()) {
    return trimTrailingSlash(options.explicit.trim());
  }
  const override = readRuntimeOverride("api");
  if (override) return trimTrailingSlash(override);
  return ARCENPAY_API_URL;
}

export function resolveArcenPayAppUrl(
  options: ResolveArcenPayAppUrlOptions = {},
): string {
  if (options.explicit?.trim()) {
    return trimTrailingSlash(options.explicit.trim());
  }
  const override = readRuntimeOverride("app");
  if (override) return trimTrailingSlash(override);
  return ARCENPAY_APP_URL;
}
