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

import * as MEAPCore from "@arcenpay/internal-core";
import { DEFAULT_CHAIN_ID } from "./platform/default-chain.js";
import { SUBGRAPH_REQUIRED } from "./platform/launch-flags.js";

const isProd =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

function resolveDefaultChainEnvironment() {
  try {
    return getChainEnvironmentCompat(DEFAULT_CHAIN_ID);
  } catch {
    return getChainEnvironmentCompat(84532);
  }
}

const DEFAULT_CHAIN_ENV = resolveDefaultChainEnvironment();

function getChainEnvironmentCompat(chainId: number) {
  const maybe = (MEAPCore as unknown as {
    getChainEnvironment?: (id: number) => {
      services: { rpcUrl: string; subgraphUrl?: string; facilitatorUrl?: string };
    };
  }).getChainEnvironment;
  if (typeof maybe === "function") {
    return maybe(chainId);
  }

  // Backward compatibility for stale @arcenpay/internal-core dist builds that don't yet
  // export getChainEnvironment.
  const chain = MEAPCore.getChain(chainId);
  return {
    chainId,
    chainName: chain.name,
    isTestnet: Boolean(chain.testnet),
    contracts: MEAPCore.getContractAddresses(chainId),
    services: {
      rpcUrl: chain.rpcUrls.default.http[0] || "",
      subgraphUrl: "",
      facilitatorUrl: "",
    },
  };
}


function requireInProd(name: string, value: string | undefined): string {
  if (!value && isProd) {
    throw new Error(
      `[config] Missing required environment variable in production: ${name}`,
    );
  }
  return value ?? "";
}

// ── Backend API ──────────────────────────────────────────────────────────────

export const BACKEND_URL: string = (() => {
  const val = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;
  return requireInProd("BACKEND_URL", val) || "http://localhost:3300";
})();

// ── Facilitator ───────────────────────────────────────────────────────────────

/**
 * URL of the ArcenPay facilitator server.
 * Required in production. Defaults to http://localhost:3402 in development.
 * Resolves from: FACILITATOR_BASE_URL → FACILITATOR_URL →
 *                NEXT_PUBLIC_FACILITATOR_BASE_URL → NEXT_PUBLIC_FACILITATOR_URL
 */
export const FACILITATOR_URL: string = (() => {
  const val =
    process.env[`FACILITATOR_BASE_URL_${DEFAULT_CHAIN_ID}`] ||
    process.env[`FACILITATOR_URL_${DEFAULT_CHAIN_ID}`] ||
    process.env.FACILITATOR_BASE_URL ||
    process.env.FACILITATOR_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_BASE_URL ||
    process.env.NEXT_PUBLIC_FACILITATOR_URL;
  return (
    requireInProd("FACILITATOR_URL / FACILITATOR_BASE_URL", val) ||
    DEFAULT_CHAIN_ENV.services.facilitatorUrl ||
    "http://localhost:3402"
  );
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
 * The Graph studio URL for the ArcenPay subgraph.
 * Optional for Base Sepolia MVP launch; can be made mandatory with
 * ARCENPAY_REQUIRE_SUBGRAPH=true.
 */
export const GRAPH_URL: string = (() => {
  const val =
    process.env[`NEXT_PUBLIC_GRAPH_URL_${DEFAULT_CHAIN_ID}`] ||
    process.env.NEXT_PUBLIC_GRAPH_URL ||
    process.env[`MEAP_SUBGRAPH_URL_${DEFAULT_CHAIN_ID}`] ||
    process.env.MEAP_SUBGRAPH_URL ||
    DEFAULT_CHAIN_ENV.services.subgraphUrl;
  if (!val) {
    if (isProd && SUBGRAPH_REQUIRED) {
      throw new Error(
        "[config] NEXT_PUBLIC_GRAPH_URL must be set in production.",
      );
    }
    console.warn(
      SUBGRAPH_REQUIRED
        ? "[config] NEXT_PUBLIC_GRAPH_URL is not set. Subgraph queries will fail."
        : "[config] NEXT_PUBLIC_GRAPH_URL is not set. Subgraph-backed analytics will be unavailable.",
    );
    return "";
  }
  if (isProd && SUBGRAPH_REQUIRED && val.includes("/placeholder/")) {
    throw new Error(
      "[config] NEXT_PUBLIC_GRAPH_URL contains a placeholder — set a real subgraph URL.",
    );
  }
  return val;
})();

/**
 * Resolves subgraph URL for a specific chain ID.
 * Resolution order:
 *   NEXT_PUBLIC_GRAPH_URL_<chainId>
 *   MEAP_SUBGRAPH_URL_<chainId>
 *   NEXT_PUBLIC_GRAPH_URL
 *   MEAP_SUBGRAPH_URL
 *   chain manifest subgraphUrl
 */
export function getGraphUrl(chainId: number): string {
  const specific =
    process.env[`NEXT_PUBLIC_GRAPH_URL_${chainId}`] ||
    process.env[`MEAP_SUBGRAPH_URL_${chainId}`];
  if (specific) return specific;

  const global =
    process.env.NEXT_PUBLIC_GRAPH_URL ||
    process.env.MEAP_SUBGRAPH_URL;
  if (global) return global;

  try {
    return getChainEnvironmentCompat(chainId).services.subgraphUrl || "";
  } catch {
    return "";
  }
}

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
  return requireInProd("FACILITATOR_SECRET", process.env.FACILITATOR_SECRET);
})();

// ── RPC URLs ──────────────────────────────────────────────────────────────────

/**
 * Parses a comma-separated RPC URL string into an ordered list.
 * e.g. "https://alchemy.com/key,https://infura.io/key" → ["https://alchemy.com/key", "https://infura.io/key"]
 */
function parseRpcList(raw: string): string[] {
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

// Per-chain round-robin cursor (server-side, resets on cold start)
const rpcRotationCursors: Record<number, number> = {};

/**
 * Returns the next RPC URL for a given chainId using round-robin rotation across
 * a comma-separated list. Falls back to public endpoints in development only.
 *
 * Set RPC_URL_<chainId> to a comma-separated list for automatic failover:
 *   RPC_URL_11155111=https://alchemy.../key,https://infura.../key
 */
export function getRpcUrl(chainId: number): string {
  const rawSpecific = process.env[`RPC_URL_${chainId}`];
  const rawGlobal = process.env.RPC_URL;
  const rawManifest = (() => {
    try { return getChainEnvironmentCompat(chainId).services.rpcUrl; } catch { return ""; }
  })();

  const candidates = parseRpcList(rawSpecific ?? rawGlobal ?? rawManifest ?? "");

  if (candidates.length > 0) {
    if (candidates.length === 1) return candidates[0];
    // Round-robin: advance cursor on each call so callers naturally spread load
    const cursor = (rpcRotationCursors[chainId] ?? 0) % candidates.length;
    rpcRotationCursors[chainId] = cursor + 1;
    return candidates[cursor];
  }

  if (isProd) {
    throw new Error(
      `[config] RPC_URL_${chainId} (or RPC_URL) must be set in production. ` +
      `Comma-separate multiple URLs for automatic failover.`,
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

/**
 * Returns ALL configured RPC URLs for a chain (for use with viem fallback transport).
 * Returns a single-element array if only one is configured.
 */
export function getAllRpcUrls(chainId: number): string[] {
  const rawSpecific = process.env[`RPC_URL_${chainId}`];
  const rawGlobal = process.env.RPC_URL;
  const rawManifest = (() => {
    try { return getChainEnvironmentCompat(chainId).services.rpcUrl; } catch { return ""; }
  })();

  const candidates = parseRpcList(rawSpecific ?? rawGlobal ?? rawManifest ?? "");
  if (candidates.length > 0) return candidates;

  const fallback = getRpcUrl(chainId);
  return fallback ? [fallback] : [];
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
