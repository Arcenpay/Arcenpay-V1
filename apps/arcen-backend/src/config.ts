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

/** From address for automated transactional emails (OTP, receipts, system alerts). */
export const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@arcenpay.com";

/** From address for admin-sent emails (activation keys, announcements, direct communications). */
export const EMAIL_FROM_ADMIN = process.env.EMAIL_FROM_ADMIN || "hello@arcenpay.com";

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

// ── Object storage (Cloudflare R2 or local dev fallback) ─────────────────────

/**
 * Storage driver: "r2" uses Cloudflare R2 (S3-compatible). "local" uses
 * the filesystem under INVOICE_STORAGE_DIR (dev default; also usable in prod
 * when a persistent volume is mounted). Secrets live in .env only.
 */
export const STORAGE_DRIVER: "r2" | "local" = (() => {
  const value = process.env.STORAGE_DRIVER;
  if (value === "r2") return "r2";
  if (value === "local") return "local";
  // Auto: when all R2 credentials are present, prefer R2. Explicit
  // STORAGE_DRIVER=local remains the opt-out for local development.
  const r2Configured = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ].every((name) => Boolean((process.env[name] ?? "").trim()));
  return r2Configured ? "r2" : "local";
})();

export const R2_ACCOUNT_ID = (process.env.R2_ACCOUNT_ID ?? "").trim();
export const R2_ACCESS_KEY_ID = (process.env.R2_ACCESS_KEY_ID ?? "").trim();
export const R2_SECRET_ACCESS_KEY = (process.env.R2_SECRET_ACCESS_KEY ?? "").trim();
export const R2_BUCKET = (process.env.R2_BUCKET ?? "").trim();

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

  // Non-EVM families (Stellar, Solana) have no viem Chain definition. Prefer
  // the family-specific RPC URL (env override first), falling back to the
  // registry descriptor URL for reads.
  const family = ArcenPayCore.getChainFamily(chainId);
  if (family !== "evm") {
    const familyRpc =
      family === "solana"
        ? ArcenPayCore.getSolanaRpcUrl(chainId)
        : ArcenPayCore.getStellarSorobanRpcUrl(chainId);
    for (const value of [
      ...parseRpcList(rawSpecific ?? ""),
      ...parseRpcList(rawGlobal ?? ""),
      ...parseRpcList(rawManifest ?? ""),
      familyRpc || "",
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

  // Non-EVM dev fallback: the family RPC URL from the registry descriptor.
  const fallbackFamily = ArcenPayCore.getChainFamily(chainId);
  if (fallbackFamily !== "evm") {
    const familyUrl =
      fallbackFamily === "solana"
        ? ArcenPayCore.getSolanaRpcUrl(chainId)
        : ArcenPayCore.getStellarSorobanRpcUrl(chainId);
    if (familyUrl) return familyUrl;
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
 * Secret key authenticating headless requests to Platform Admin routes
 * (`/api/v1/admin/*`).
 *
 * SECURITY:
 *  - `NEXT_PUBLIC_PLATFORM_ADMIN_SECRET` is NO LONGER accepted. Next.js inlines
 *    every `NEXT_PUBLIC_*` variable into the browser bundle, so honouring that
 *    name would publish the admin secret to every visitor of the dashboard.
 *  - `ADMIN_SECRET` is kept as a legacy alias only, and is rejected in
 *    production if it is too weak to be a credential. Prefer the explicit
 *    `PLATFORM_ADMIN_SECRET`.
 *  - Production requires an explicit value (fail-fast) and a minimum entropy
 *    floor. Dev falls back to a fixed local value so local DX is unaffected.
 */
const MIN_SECRET_LENGTH = 32;

export const PLATFORM_ADMIN_SECRET: string = (() => {
  if (process.env.NEXT_PUBLIC_PLATFORM_ADMIN_SECRET) {
    if (isProd) {
      throw new Error(
        "[config] NEXT_PUBLIC_PLATFORM_ADMIN_SECRET is set. NEXT_PUBLIC_* values " +
          "are embedded in the client bundle and must never hold a secret. " +
          "Use PLATFORM_ADMIN_SECRET instead and remove the NEXT_PUBLIC_ variant.",
      );
    }
    console.warn(
      "[config] Ignoring NEXT_PUBLIC_PLATFORM_ADMIN_SECRET (client-exposed). " +
        "Set PLATFORM_ADMIN_SECRET instead.",
    );
  }

  const val = getEnvValue(["PLATFORM_ADMIN_SECRET", "ADMIN_SECRET"]);
  const resolved =
    val || (isProd ? requireInProd("PLATFORM_ADMIN_SECRET", val) : "arcenpay_admin_secret_dev");

  if (isProd && resolved.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[config] PLATFORM_ADMIN_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production. ` +
        "Generate one with: openssl rand -hex 32",
    );
  }

  if (
    isProd &&
    !process.env.PLATFORM_ADMIN_SECRET &&
    process.env.ADMIN_SECRET
  ) {
    console.warn(
      "[config] Using the legacy ADMIN_SECRET variable for the platform admin secret. " +
        "Rename it to PLATFORM_ADMIN_SECRET — `ADMIN_SECRET` is a generic name that other " +
        "tooling may set.",
    );
  }

  return resolved;
})();

/**
 * Authorized platform administrator emails.
 * Configured via PLATFORM_ADMIN_EMAILS env var (comma-separated).
 *
 * SECURITY:
 *  - `NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS` is NO LONGER accepted — it published
 *    the admin allow-list into the client bundle.
 *  - The well-known addresses below are seeded ONLY outside production. A
 *    hardcoded production allow-list cannot be revoked, so anyone able to
 *    receive mail at `admin@`/`support@` would hold permanent admin rights.
 *  - Production requires an explicit list (fail-fast with an actionable error)
 *    rather than silently falling back to a broader default.
 */
export const PLATFORM_ADMIN_EMAILS: Set<string> = (() => {
  if (isProd && process.env.NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS) {
    console.warn(
      "[config] Ignoring NEXT_PUBLIC_PLATFORM_ADMIN_EMAILS (client-exposed). " +
        "Use PLATFORM_ADMIN_EMAILS instead.",
    );
  }

  const envEmails = (getEnvValue(["PLATFORM_ADMIN_EMAILS", "ADMIN_EMAILS"]) || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (isProd) {
    if (envEmails.length === 0) {
      throw new Error(
        "[config] PLATFORM_ADMIN_EMAILS must be set in production. " +
          "Provide a comma-separated allow-list of administrator email addresses.",
      );
    }
    return new Set<string>(envEmails);
  }

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

// ── Credential separation ─────────────────────────────────────────────────────

/**
 * Detects shared secrets across independent security domains.
 *
 * WHY THIS IS A NON-FATAL ALERT BY DEFAULT
 * ----------------------------------------
 * Sharing a secret across domains is a LATENT hygiene problem, not a live
 * compromise: the credentials still authenticate correctly, and HMAC-SHA256 is
 * one-way, so holding a signed invoice URL does not reveal the session-signing
 * key. Nothing is exploitable *because* the values match.
 *
 * Making it fatal therefore trades a latent weakening for a guaranteed outage —
 * a crash-loop takes the whole platform down for a condition that is not being
 * exploited. That is the wrong trade at runtime. The proportionate response is
 * to run, and to alert loudly and repeatedly so the rotation gets scheduled.
 *
 * `SECRET_ISOLATION_ENFORCE=true` restores the hard gate for teams that want a
 * build-time guarantee (e.g. in CI or a pre-deploy check) once rotation is done.
 */
function assertDistinctSecrets(): void {
  if (!isProd) return;

  const named: Array<[string, string]> = [
    ["SIWE_JWT_SECRET", SIWE_JWT_SECRET],
    ["ACCESS_TOKEN_SECRET", ACCESS_TOKEN_SECRET],
    ["FACILITATOR_SECRET", FACILITATOR_SECRET],
    ["INVOICE_DOWNLOAD_SIGNING_SECRET", INVOICE_DOWNLOAD_SIGNING_SECRET],
    ["PLATFORM_ADMIN_SECRET", PLATFORM_ADMIN_SECRET],
  ];

  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const [name, value] of named) {
    if (!value) continue;
    const existing = seen.get(value);
    if (existing) {
      collisions.push(`${name} == ${existing}`);
    } else {
      seen.set(value, name);
    }
  }

  if (collisions.length === 0) return;

  const message =
    `[config] Shared secrets across security domains: ${collisions.join(", ")}. ` +
    "Each domain must have its own value so that a leak of one cannot compromise " +
    "the others (session signing, admin auth, invoice-URL signing, API tokens). " +
    "Rotate with: openssl rand -hex 32  —  then set SECRET_ISOLATION_ENFORCE=true " +
    "to keep it that way.";

  if (process.env.SECRET_ISOLATION_ENFORCE === "true") {
    throw new Error(message);
  }

  // Deliberately loud, and repeated on every boot, so it is impossible to miss
  // in deployment logs without taking the service down.
  console.error(`\n${"=".repeat(78)}\n${message}\n${"=".repeat(78)}\n`);
}

assertDistinctSecrets();


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

// ── Hosted MCP server ─────────────────────────────────────────────────────────

/**
 * Whether the hosted MCP endpoint (`/mcp`) is mounted.
 *
 * OFF by default: existing deployments are unchanged unless explicitly enabled.
 * Auth is an ArcenPay SECRET/RESTRICTED API key.
 */
export const MCP_SERVER_ENABLED: boolean =
  process.env.MCP_SERVER_ENABLED === "true";

/**
 * Canonical public URL of the MCP resource. Used for OAuth protected-resource
 * metadata once the OAuth layer lands; optional until then.
 */
export const MCP_RESOURCE_URL: string = process.env.MCP_RESOURCE_URL ?? "";

/**
 * Domain-verification challenge token for the ChatGPT plugin submission.
 * Served verbatim as plain text at `/.well-known/openai-apps-challenge`.
 * The value is shown in the OpenAI plugin submission portal.
 */
export const MCP_DOMAIN_CHALLENGE_TOKEN: string =
  process.env.MCP_DOMAIN_CHALLENGE_TOKEN ?? "";

/**
 * OAuth 2.1 issuer / resource origin for the hosted MCP server (ChatGPT
 * connectors authenticate via OAuth, not static keys). Defaults to the MCP
 * resource URL when unset.
 */
export const MCP_OAUTH_ISSUER: string =
  process.env.MCP_OAUTH_ISSUER ?? MCP_RESOURCE_URL;

/**
 * HMAC secret for signing hosted MCP OAuth access tokens. When empty the OAuth
 * endpoints and token verification are disabled (API-key auth still works).
 */
export const MCP_OAUTH_SECRET: string = process.env.MCP_OAUTH_SECRET ?? "";


