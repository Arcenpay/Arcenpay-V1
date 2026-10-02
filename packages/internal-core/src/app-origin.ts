declare global {
  // eslint-disable-next-line no-var
  var __ARCENPAY_API_URL__: string | undefined;
  // eslint-disable-next-line no-var
  var __ARCENPAY_APP_URL__: string | undefined;
}

/**
 * Runtime override, checked before the env vars. Lets a host app (e.g. the demo
 * dApp) point the SDK at a local/staging backend even when process.env is
 * stubbed by its bundler.
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

export const ARCENPAY_API_URL =
  readRuntimeOverride("api") ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  process.env.BACKEND_URL ||
  "http://localhost:3300";
export const ARCENPAY_APP_URL =
  readRuntimeOverride("app") ||
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  "http://localhost:3000";

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
  return ARCENPAY_API_URL;
}

export function resolveArcenPayAppUrl(
  options: ResolveArcenPayAppUrlOptions = {},
): string {
  if (options.explicit?.trim()) {
    return trimTrailingSlash(options.explicit.trim());
  }
  return ARCENPAY_APP_URL;
}
