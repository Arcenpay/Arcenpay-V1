export const ARCENPAY_LOCAL_APP_URL = "http://localhost:3000";
export const ARCENPAY_PRODUCTION_APP_URL = "https://app.arcenpay.com";

export interface ResolveArcenPayBaseUrlOptions {
  explicit?: string;
  env?: Record<string, string | undefined> | undefined;
  envKeys?: readonly string[];
  localDevUrl?: string;
  productionUrl?: string;
}

const DEFAULT_ENV_KEYS = [
  "ARCENPAY_BASE_URL",
  "NEXT_PUBLIC_ARCENPAY_BASE_URL",
] as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function getRuntimeEnv(): Record<string, string | undefined> | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env as Record<string, string | undefined>;
}

function readEnvValue(
  env: Record<string, string | undefined> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!env) return undefined;
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function resolveArcenPayBaseUrl(
  options: ResolveArcenPayBaseUrlOptions = {},
): string {
  if (options.explicit?.trim()) {
    return trimTrailingSlash(options.explicit.trim());
  }

  const env = options.env ?? getRuntimeEnv();
  const envOverride = readEnvValue(env, options.envKeys ?? DEFAULT_ENV_KEYS);
  if (envOverride) {
    return trimTrailingSlash(envOverride);
  }

  const localDevUrl = options.localDevUrl ?? ARCENPAY_LOCAL_APP_URL;
  const productionUrl = options.productionUrl ?? ARCENPAY_PRODUCTION_APP_URL;
  const nodeEnv = env?.NODE_ENV;

  if (nodeEnv && nodeEnv !== "production") {
    return localDevUrl;
  }

  return productionUrl;
}
