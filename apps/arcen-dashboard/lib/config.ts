// ============================================================
//  Dashboard — Centralized Environment Configuration
//
//  All env var resolution and production validation lives here.
//  Fail-fast at module-load time in production so misconfigured
//  deployments never silently fall back to localhost defaults.
//
//  Rules:
//  - Required in production → throw Error at load time
//  - Optional with safe default → return default but warn
//  - Dev-only default (localhost) → return default but never
//    let it reach a production runtime
// ============================================================

const isProd =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";


function requireInProd(name: string, value: string | undefined): string {
  if (!value && isProd) {
    throw new Error(
      `[config] Missing required environment variable in production: ${name}`,
    );
  }
  return value ?? "";
}

// ── Facilitator ───────────────────────────────────────────────────────────────

/**
 * URL of the ArcenPay facilitator server.
 * Required in production. Defaults to http://localhost:3402 in development.
 * Resolves from: FACILITATOR_BASE_URL → FACILITATOR_URL →
 *                NEXT_PUBLIC_FACILITATOR_BASE_URL → NEXT_PUBLIC_FACILITATOR_URL
 */
export const FACILITATOR_URL: string = (() => {
  const val =
    process.env.FACILITATOR_BASE_URL ||
    process.env.FACILITATOR_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL;
  return requireInProd("FACILITATOR_URL / FACILITATOR_BASE_URL", val) || "http://localhost:3402";
})();

// ── Application base URL ──────────────────────────────────────────────────────

/**
 * Public-facing base URL of the dashboard (used in emails and signed download URLs).
 * Required in production.
 * Resolves from: NEXT_PUBLIC_APP_URL → NEXTAUTH_URL → VERCEL_URL (auto-prefixed with https://)
 */
export const APP_URL: string = (() => {
  const val =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  return requireInProd("NEXT_PUBLIC_APP_URL / NEXTAUTH_URL", val) || "http://localhost:3000";
})();

// ── Subgraph ──────────────────────────────────────────────────────────────────

/**
 * The Graph studio URL for the MEAP subgraph.
 * Required in production (placeholder URL is explicitly rejected).
 */
export const GRAPH_URL: string = (() => {
  const val = process.env.NEXT_PUBLIC_GRAPH_URL;
  if (!val) {
    if (isProd) {
      throw new Error(
        "[config] NEXT_PUBLIC_GRAPH_URL must be set in production.",
      );
    }
    // Dev warning so developers notice before deploying
    console.warn(
      "[config] NEXT_PUBLIC_GRAPH_URL is not set. Subgraph queries will fail.",
    );
    return "";
  }
  if (isProd && val.includes("/placeholder/")) {
    throw new Error(
      "[config] NEXT_PUBLIC_GRAPH_URL contains a placeholder — set a real subgraph URL.",
    );
  }
  return val;
})();

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * SIWE JWT signing secret.
 * Required in production.
 */
export const SIWE_JWT_SECRET: string = (() => {
  const val = process.env.SIWE_JWT_SECRET;
  return requireInProd("SIWE_JWT_SECRET", val) || "dev_siwe_jwt_secret_not_for_production";
})();

// ── Email ─────────────────────────────────────────────────────────────────────

/** Resend API key. Required when sending any transactional email. */
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

/** From address for transactional emails. */
export const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@arcenpay.xyz";

// ── Invoice ───────────────────────────────────────────────────────────────────

/**
 * HMAC secret for signed invoice download URLs.
 * Required in production. Falls back to SIWE_JWT_SECRET in development.
 */
export const INVOICE_DOWNLOAD_SIGNING_SECRET: string = (() => {
  const explicit = process.env.INVOICE_DOWNLOAD_SIGNING_SECRET;
  if (explicit) return explicit;
  if (isProd) {
    throw new Error(
      "[config] INVOICE_DOWNLOAD_SIGNING_SECRET must be set in production.",
    );
  }
  return SIWE_JWT_SECRET;
})();

/**
 * File system directory for generated invoice PDFs.
 * Required in production.
 */
export const INVOICE_STORAGE_DIR: string = (() => {
  const val = process.env.INVOICE_STORAGE_DIR;
  return requireInProd("INVOICE_STORAGE_DIR", val) || "/tmp/arcenpay/invoices";
})();

/** Signed URL TTL in seconds (default 24 hours). */
export const INVOICE_DOWNLOAD_URL_TTL_SECONDS: number = (() => {
  const raw = process.env.INVOICE_DOWNLOAD_URL_TTL_SECONDS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 86400;
})();

// ── Facilitator auth ──────────────────────────────────────────────────────────

/**
 * Shared secret used to authenticate dashboard → facilitator requests.
 * Optional: if set, all facilitator proxy routes send it as Bearer token.
 * Required in production to prevent unauthenticated facilitator access.
 */
export const FACILITATOR_SECRET: string = (() => {
  const val = process.env.FACILITATOR_SECRET;
  if (!val && isProd) {
    console.warn(
      "[config] FACILITATOR_SECRET is not set in production — facilitator endpoints are unauthenticated.",
    );
  }
  return val ?? "";
})();

// ── RPC URLs ──────────────────────────────────────────────────────────────────

/**
 * Returns the server-side RPC URL for a given chainId.
 * Checks RPC_URL_<chainId> first, then falls back to RPC_URL global, then public endpoints (dev only).
 * Required in production for any chain that will be switched to.
 */
export function getRpcUrl(chainId: number): string {
  const specific = process.env[`RPC_URL_${chainId}`];
  if (specific) return specific;
  const global_ = process.env.RPC_URL;
  if (global_) return global_;
  if (isProd) {
    throw new Error(
      `[config] RPC_URL_${chainId} (or RPC_URL) must be set in production.`,
    );
  }
  // Public fallback endpoints — development only
  const publicRpcs: Record<number, string> = {
    11155111: "https://rpc.sepolia.org",
    8453: "https://mainnet.base.org",
    84532: "https://sepolia.base.org",
    1: "https://cloudflare-eth.com",
  };
  return publicRpcs[chainId] ?? "";
}

// ── WalletConnect ─────────────────────────────────────────────────────────────

/**
 * WalletConnect / Reown project ID.
 * Required — empty string will cause WalletConnect modal to fail at runtime.
 */
export const WALLETCONNECT_PROJECT_ID: string = (() => {
  const val = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  return requireInProd("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", val) || "";
})();
