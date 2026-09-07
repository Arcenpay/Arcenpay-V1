export const ARCENPAY_API_URL = "https://api.arcenpay.com";
export const ARCENPAY_APP_URL = "https://app.arcenpay.com";

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
