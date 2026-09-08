// ============================================================
//  ArcenPay Backend — Centralized Environment Configuration
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

import "./load-env.js";
import {
  createPublicClient,
  fallback,
  http,
  type Transport,
  type PublicClient,
} from "viem";
import * as ArcenPayCore from "@arcenpay/internal-core";
import { DEFAULT_CHAIN_ID } from "./lib/platform/default-chain.js";
import { SUBGRAPH_REQUIRED } from "./lib/platform/launch-flags.js";

export const PORT = parseInt(process.env.PORT ?? "3300", 10);

const isProd = process.env.NODE_ENV === "production";

function resolveDefaultChainEnvironment() {
  try {
    return getChainEnvironmentCompat(DEFAULT_CHAIN_ID);
  } catch {
    return getChainEnvironmentCompat(84532);
  }
}

const DEFAULT_CHAIN_ENV = resolveDefaultChainEnvironment();

function getChainEnvironmentCompat(chainId: number) {
  const maybe = (
    ArcenPayCore as unknown as {
      getChainEnvironment?: (id: number) => {
        services: {
          rpcUrl: string;
          subgraphUrl?: string;
          facilitatorUrl?: string;
        };
      };
    }
  ).getChainEnvironment;
  if (typeof maybe === "function") {
    return maybe(chainId);
  }

  // Backward compatibility for stale @arcenpay/internal-core dist builds that don't yet
  // export getChainEnvironment.
  const chain = ArcenPayCore.getChain(chainId);
  return {
    chainId,
    chainName: chain.name,
    isTestnet: Boolean(chain.testnet),
    contracts: ArcenPayCore.getContractAddresses(chainId),
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

function getEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
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
 * Public-facing base URL of the app (used in emails and signed download URLs).
 * Required in production.
 * Resolves from: APP_URL → DASHBOARD_URL
 */
export const APP_URL: string = (() => {
  const val = process.env.APP_URL || process.env.DASHBOARD_URL;
  return requireInProd("APP_URL", val) || "http://localhost:3000";
})();

// ── Subgraph ──────────────────────────────────────────────────────────────────

/**
 * The Graph studio URL for the ArcenPay subgraph.
 * Optional for Base Sepolia MVP launch; can be made mandatory with
 * ARCENPAY_REQUIRE_SUBGRAPH=true.
 */
export const GRAPH_URL: string = (() => {
  const val =
    getEnvValue([
      `ARCENPAY_SUBGRAPH_URL_${DEFAULT_CHAIN_ID}`,
      `GRAPH_URL_${DEFAULT_CHAIN_ID}`,
      "ARCENPAY_SUBGRAPH_URL",
      "GRAPH_URL",
    ]) || DEFAULT_CHAIN_ENV.services.subgraphUrl;
  if (!val) {
    if (isProd && SUBGRAPH_REQUIRED) {
      throw new Error("[config] GRAPH_URL must be set in production.");
    }
    return "";
  }
  if (isProd && SUBGRAPH_REQUIRED && val.includes("/placeholder/")) {
    throw new Error(
      "[config] GRAPH_URL contains a placeholder — set a real subgraph URL.",
    );
  }
  return val;
})();

/**
 * Resolves subgraph URL for a specific chain ID.
 * Resolution order:
 *   ARCENPAY_SUBGRAPH_URL_<chainId>
 *   GRAPH_URL_<chainId>
 *   ARCENPAY_SUBGRAPH_URL
 *   GRAPH_URL
 *   chain manifest subgraphUrl
 */
export function getGraphUrl(chainId: number): string {
  const specific = getEnvValue([
    `ARCENPAY_SUBGRAPH_URL_${chainId}`,
    `GRAPH_URL_${chainId}`,
  ]);
  if (specific) return specific;

  const global = getEnvValue(["ARCENPAY_SUBGRAPH_URL", "GRAPH_URL"]);
  if (global) return global;

  try {
    return getChainEnvironmentCompat(chainId).services.subgraphUrl || "";
  } catch {
    return "";
  }
}

// ── ArcenPay Platform Self-Billing ───────────────────────────────────────────

export const PLATFORM_BILLING_CHAIN_ID = Number(
  process.env.PLATFORM_BILLING_CHAIN_ID || "5042002",
);

export const PLATFORM_BILLING_OPS_PRIVATE_KEY: string = (() => {
  const val = process.env.PLATFORM_BILLING_OPS_PRIVATE_KEY;
  return requireInProd("PLATFORM_BILLING_OPS_PRIVATE_KEY", val);
})();

export const PLATFORM_BILLING_TREASURY_ADDRESS: string = (() => {
  const val = process.env.PLATFORM_BILLING_TREASURY_ADDRESS;
  return requireInProd("PLATFORM_BILLING_TREASURY_ADDRESS", val);
})();

export const PLATFORM_BILLING_ACCEPTED_TOKEN: string = (() => {
  const val =
    process.env.PLATFORM_BILLING_ACCEPTED_TOKEN ||
    ArcenPayCore.getTokenAddress(PLATFORM_BILLING_CHAIN_ID, "USDC") ||
    "";
  return requireInProd("PLATFORM_BILLING_ACCEPTED_TOKEN", val);
})();

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * SIWE JWT signing secret.
 * Required in production.
 */
export const SIWE_JWT_SECRET: string = (() => {
  const val = process.env.SIWE_JWT_SECRET;
  return (
    requireInProd("SIWE_JWT_SECRET", val) ||
    "dev_siwe_jwt_secret_not_for_production"
  );
})();

/**
 * Secret used to sign embed access tokens and preview tokens.
 * Required in production.
 */
export const ACCESS_TOKEN_SECRET: string = (() => {
  const val = process.env.ACCESS_TOKEN_SECRET?.trim();
  return requireInProd("ACCESS_TOKEN_SECRET", val) || SIWE_JWT_SECRET;
})();

// ── Email ─────────────────────────────────────────────────────────────────────

/** Resend API key. Required when sending any transactional email. */
export const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";

/** From address for transactional emails. */
export const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@arcenpay.com";

// ── Dune Analytics ────────────────────────────────────────────────────────────

/** Dune Analytics API key for on-chain metrics queries. Optional; without it Dune features will show a "configure" prompt. */
export const DUNE_API_KEY = process.env.DUNE_API_KEY ?? "";
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

function collectRpcCandidates(chainId: number): string[] {
  const rawSpecific = process.env[`RPC_URL_${chainId}`];
  const rawGlobal = process.env.RPC_URL;
  const rawManifest = (() => {
    try {
      return getChainEnvironmentCompat(chainId).services.rpcUrl;
    } catch {
      return "";
    }
  })();

  const seen = new Set<string>();
  const candidates: string[] = [];

  // Non-EVM families (Stellar…) have no viem Chain definition. Prefer the
  // Soroban RPC URL (env override first), falling back to the registry's
  // Horizon URL for reads.
  if (ArcenPayCore.getChainFamily(chainId) !== "evm") {
    for (const value of [
      ...parseRpcList(rawSpecific ?? ""),
      ...parseRpcList(rawGlobal ?? ""),
      ...parseRpcList(rawManifest ?? ""),
      ArcenPayCore.getStellarSorobanRpcUrl(chainId) || "",
    ]) {
      if (!value || seen.has(value)) continue;
      seen.add(value);
      candidates.push(value);
    }
    return candidates;
  }

  const chainRpcs =
    ArcenPayCore.getChain(chainId)?.rpcUrls?.default?.http ?? [];

  for (const value of [
    ...parseRpcList(rawSpecific ?? ""),
    ...parseRpcList(rawGlobal ?? ""),
    ...parseRpcList(rawManifest ?? ""),
    ...chainRpcs,
  ]) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }
  return candidates;
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
  const candidates = collectRpcCandidates(chainId);

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
    // Arc Testnet: use QuikNode paid endpoint as dev fallback (higher rate limits)
    5042002:
      "https://sleek-sleek-resonance.arc-testnet.quiknode.pro/9447b76a1f0e822664b55dc6858f4ba4beebc153/",
    677: "https://rpc.botchain.ai",
    968: "https://rpc.bohr.life",
    1: "https://cloudflare-eth.com",
  };
  const fromPublic = publicRpcs[chainId];
  if (fromPublic) return fromPublic;

  // Stellar dev fallback: the Soroban RPC URL from the registry descriptor.
  if (ArcenPayCore.getChainFamily(chainId) !== "evm") {
    const sorobanUrl = ArcenPayCore.getStellarSorobanRpcUrl(chainId);
    if (sorobanUrl) return sorobanUrl;
    return ArcenPayCore.getChainDescriptor(chainId)?.rpcUrl ?? "";
  }

  return "";
}

/**
 * Returns ALL configured RPC URLs for a chain (for use with viem fallback transport).
 * Returns a single-element array if only one is configured.
 */
export function getAllRpcUrls(chainId: number): string[] {
  const candidates = collectRpcCandidates(chainId);
  if (candidates.length > 0) return candidates;

  const fallback = getRpcUrl(chainId);
  return fallback ? [fallback] : [];
}

/**
 * Creates a resilient Viem Transport configured with exponential retry backoff
 * (retryCount: 4, retryDelay: 1000ms, timeout: 15s) and automatic RPC failover
 * via fallback() transport when multiple RPC URLs are configured.
 */
export function getRpcTransport(chainId: number): Transport {
  const urls = getAllRpcUrls(chainId);
  if (urls.length === 0) {
    const single = getRpcUrl(chainId);
    if (single) urls.push(single);
  }

  const httpOptions = {
    retryCount: 2,
    retryDelay: 1500,
    timeout: 15_000,
  };

  if (urls.length > 1) {
    return fallback(
      urls.map((url) => http(url, httpOptions)),
      { rank: false, retryCount: 1 },
    );
  }

  if (urls.length === 1) {
    return http(urls[0], httpOptions);
  }

  return http("", httpOptions);
}

/**
 * Standardized factory for Viem PublicClient with automatic retry policies and RPC failover.
 */
export function createResilientPublicClient(chainId: number): PublicClient {
  const chain = ArcenPayCore.getChain(chainId);
  return createPublicClient({
    chain,
    transport: getRpcTransport(chainId),
  });
}

// ── Smart Account Infra ───────────────────────────────────────────────────────

/**
 * Pimlico API key for ERC-4337 smart account infrastructure.
 * When present, Pimlico becomes the preferred hosted provider.
 */
export const PIMLICO_API_KEY: string = (() => {
  const val = getEnvValue(["PIMLICO_API_KEY", "NEXT_PUBLIC_PIMLICO_API_KEY"]);
  return val ?? "";
})();

/**
 * Optional Pimlico RPC override. Supports generic or chain-specific variants
 * via direct env access inside the route layer.
 */
export const PIMLICO_RPC_URL: string = (() => {
  const val = getEnvValue(["PIMLICO_RPC", "NEXT_PUBLIC_PIMLICO_RPC"]);
  return val ?? "";
})();

// ── WalletConnect ─────────────────────────────────────────────────────────────

/**
 * WalletConnect / Reown project ID.
 * Required — empty string will cause WalletConnect modal to fail at runtime.
 */
export const WALLETCONNECT_PROJECT_ID: string = (() => {
  const val = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  return requireInProd("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", val) || "";
})();

// ── Platform Activation & Admin ───────────────────────────────────────────────

/**
 * Secret key for authenticating requests to Platform Admin routes (/api/v1/admin/*).
 * In production, this must be set to a strong secret.
 */
export const PLATFORM_ADMIN_SECRET: string = (() => {
  const val = getEnvValue(["PLATFORM_ADMIN_SECRET", "ADMIN_SECRET", "NEXT_PUBLIC_PLATFORM_ADMIN_SECRET"]);
  return val || (isProd ? requireInProd("PLATFORM_ADMIN_SECRET", val) : "arcenpay_admin_secret_dev");
})();

/**
 * Whether the platform requires an activation key for workspace access.
 * Defaults to true if PLATFORM_REQUIRE_ACTIVATION_KEY is 'true'.
 */
export const PLATFORM_REQUIRE_ACTIVATION_KEY: boolean = (() => {
  const val = getEnvValue(["PLATFORM_REQUIRE_ACTIVATION_KEY", "NEXT_PUBLIC_PLATFORM_REQUIRE_ACTIVATION_KEY"]);
  if (val === "false") return false;
  if (val === "true") return true;
  return isProd;
})();

/**
 * Authorized platform administrator emails.
 * Configured via PLATFORM_ADMIN_EMAILS or ADMIN_EMAILS environment variable (comma-separated).
 * Defaults to admin@arcenpay.com and support@arcenpay.com if not specified.
 */
export const PLATFORM_ADMIN_EMAILS: Set<string> = (() => {
  const envEmails = (getEnvValue(["PLATFORM_ADMIN_EMAILS", "ADMIN_EMAILS", "NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS"]) || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set<string>([
    "admin@arcenpay.com",
    "aditya@arcenpay.com",
    "support@arcenpay.com",
    ...envEmails,
  ]);
})();

/**
 * Check if a given email is an authorized platform administrator.
 */
export function isPlatformAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return PLATFORM_ADMIN_EMAILS.has(email.trim().toLowerCase());
}


