// ============================================================
//  Dashboard — Minimal runtime configuration
//  After splitting the backend out of Next.js, the dashboard only
//  needs frontend/runtime-safe endpoints here.
// ============================================================

import {
  BASE_MAINNET_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  DEFAULT_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
} from "@/lib/default-chain";

function isEnabled(value: string | undefined, defaultValue = false): boolean {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
}

const SUBGRAPH_REQUIRED = isEnabled(
  process.env.ARCENPAY_REQUIRE_SUBGRAPH ?? process.env.NEXT_PUBLIC_ARCENPAY_REQUIRE_SUBGRAPH,
);

const isProd =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

const PUBLIC_CHAIN_SUBGRAPH_URLS: Record<number, string | undefined> = {
  [SEPOLIA_CHAIN_ID]:
    process.env.NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_11155111 ||
    process.env.NEXT_PUBLIC_GRAPH_URL_11155111,
  [BASE_SEPOLIA_CHAIN_ID]:
    process.env.NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_84532 ||
    process.env.NEXT_PUBLIC_GRAPH_URL_84532,
  [BASE_MAINNET_CHAIN_ID]:
    process.env.NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_8453 ||
    process.env.NEXT_PUBLIC_GRAPH_URL_8453,
};

const SERVER_CHAIN_SUBGRAPH_URLS: Record<number, string | undefined> = {
  [SEPOLIA_CHAIN_ID]: process.env.ARCENPAY_SUBGRAPH_URL_11155111,
  [BASE_SEPOLIA_CHAIN_ID]: process.env.ARCENPAY_SUBGRAPH_URL_84532,
  [BASE_MAINNET_CHAIN_ID]: process.env.ARCENPAY_SUBGRAPH_URL_8453,
};

function getConfiguredGraphUrlForChain(chainId: number): string {
  return (
    PUBLIC_CHAIN_SUBGRAPH_URLS[chainId] ||
    process.env.NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL ||
    process.env.NEXT_PUBLIC_GRAPH_URL ||
    SERVER_CHAIN_SUBGRAPH_URLS[chainId] ||
    process.env.ARCENPAY_SUBGRAPH_URL ||
    ""
  );
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

// ── Subgraph ──────────────────────────────────────────────────────────────────

/**
 * The Graph studio URL for the ArcenPay subgraph.
 * Optional for Base Sepolia MVP launch; can be made mandatory with
 * ARCENPAY_REQUIRE_SUBGRAPH=true.
 */
export const GRAPH_URL: string = (() => {
  const val = getConfiguredGraphUrlForChain(DEFAULT_CHAIN_ID);
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
 *   NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_<chainId>
 *   NEXT_PUBLIC_GRAPH_URL_<chainId>
 *   NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL
 *   NEXT_PUBLIC_GRAPH_URL
 *   ARCENPAY_SUBGRAPH_URL_<chainId>
 *   ARCENPAY_SUBGRAPH_URL
 *   chain manifest subgraphUrl
 */
export function getGraphUrl(chainId: number): string {
  return getConfiguredGraphUrlForChain(chainId);
}
