const ARCENPAY_DEMO_PRODUCTION_URL = "https://app.arcenpay.com";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function readEnvValue(): string | undefined {
  if (typeof process === "undefined") return undefined;

  const value = process.env.NEXT_PUBLIC_ARCENPAY_BASE_URL?.trim();
  return value ? trimTrailingSlash(value) : undefined;
}

/**
 * The demo defaults to the hosted production dashboard so it can run
 * standalone on localhost:3001. Set NEXT_PUBLIC_ARCENPAY_BASE_URL when you
 * want the demo to target a local or staging dashboard instead.
 */
export function resolveDemoArcenPayBaseUrl(): string {
  return readEnvValue() ?? ARCENPAY_DEMO_PRODUCTION_URL;
}
