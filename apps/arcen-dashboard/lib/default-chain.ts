import {
  getChain,
  getChainDescriptor,
  getConfiguredRuntimeChainId,
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
} from "@arcenpay/internal-core";

export const SEPOLIA_CHAIN_ID = 11155111 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const BOT_MAINNET_CHAIN_ID = 677 as const;
export const BOT_TESTNET_CHAIN_ID = 968 as const;
export { STELLAR_MAINNET_CHAIN_ID, STELLAR_TESTNET_CHAIN_ID, STELLAR_FUTURENET_CHAIN_ID };

// ─── Chain sets by environment type ─────────────────────────────────────────
// Rule: DEV environment shows ONLY testnet chains.
//       PROD environment shows ONLY mainnet chains.
// Stellar synthetic chainIds are included so the chain picker surfaces them.
// Wallet support is conditional: EVM ids use wagmi/Reown; Stellar ids require
// a Stellar wallet (Freighter) — handled in the wallet layer, not here.
export const TESTNET_CHAIN_IDS = [
  BASE_SEPOLIA_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
] as const;
// Production environments are strictly restricted to BOT Chain Mainnet,
// as BOT Chain is the only network with verified production contract deployments.
export const MAINNET_CHAIN_IDS = [
  BOT_MAINNET_CHAIN_ID,
] as const;

const ALL_SUPPORTED = [...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS] as const;
export const SUPPORTED_DASHBOARD_CHAIN_IDS = ALL_SUPPORTED;

export type TestnetChainId = (typeof TESTNET_CHAIN_IDS)[number];
export type MainnetChainId = (typeof MAINNET_CHAIN_IDS)[number];
export type SupportedDashboardChainId = TestnetChainId | MainnetChainId;
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

const TESTNET_SET = new Set<number>(TESTNET_CHAIN_IDS);
const MAINNET_SET = new Set<number>(MAINNET_CHAIN_IDS);
const ALL_SUPPORTED_SET = new Set<number>(ALL_SUPPORTED);

function parseChainId(value: unknown): SupportedDashboardChainId | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return ALL_SUPPORTED_SET.has(numeric)
    ? (numeric as SupportedDashboardChainId)
    : null;
}

export function isSupportedDashboardChainId(
  value: unknown,
): value is SupportedDashboardChainId {
  return parseChainId(value) !== null;
}

export function isTestnetChainId(value: unknown): value is TestnetChainId {
  return typeof value === "number" && TESTNET_SET.has(value);
}

export function isMainnetChainId(value: unknown): value is MainnetChainId {
  return typeof value === "number" && MAINNET_SET.has(value);
}

/** Returns the chain IDs valid for a given environment mode.
 *  DEV → testnets only. PROD → mainnets only. */
export function getChainIdsForEnvironment(
  mode: EnvironmentMode,
): readonly number[] {
  return mode === "PRODUCTION" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;
}

/** The runtime-configured default (from env var). Falls back to Arc Testnet. */
export const DEFAULT_CHAIN_ID: SupportedDashboardChainId =
  parseChainId(getConfiguredRuntimeChainId()) ?? ARC_TESTNET_CHAIN_ID;

export const DEFAULT_TESTNET_CHAIN_ID: TestnetChainId =
  TESTNET_SET.has(DEFAULT_CHAIN_ID)
    ? (DEFAULT_CHAIN_ID as TestnetChainId)
    : BASE_SEPOLIA_CHAIN_ID;

export const DEFAULT_MAINNET_CHAIN_ID: MainnetChainId = BOT_MAINNET_CHAIN_ID;

export const DEFAULT_PRODUCTION_CHAIN_ID: SupportedDashboardChainId =
  DEFAULT_MAINNET_CHAIN_ID;

export function normalizeEnvironmentMode(value: unknown): EnvironmentMode {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "PRODUCTION") return "PRODUCTION";
  }
  return "DEVELOPMENT";
}

export function resolveEnvironmentChainId(
  environmentMode: EnvironmentMode,
  requestedChainId?: unknown,
): SupportedDashboardChainId {
  const explicit = parseChainId(requestedChainId);
  if (explicit) {
    // Validate the requested chain is valid for this env
    const allowed = getChainIdsForEnvironment(environmentMode);
    if ((allowed as readonly number[]).includes(explicit)) return explicit;
  }
  return environmentMode === "PRODUCTION"
    ? DEFAULT_MAINNET_CHAIN_ID
    : DEFAULT_TESTNET_CHAIN_ID;
}

export function getChainLabel(chainId: number): string {
  // Family-aware: viem `getChain()` only knows EVM chains; for Stellar (and
  // any future non-EVM family) fall back to the chain descriptor from
  // internal-core's CHAIN_REGISTRY.
  const descriptor = getChainDescriptor(chainId);
  if (descriptor) return descriptor.name;
  try {
    return getChain(chainId).name;
  } catch {
    return `Chain ${chainId}`;
  }
}

export function formatChainLabels(chainIds: readonly number[]): string {
  const labels = Array.from(chainIds).map(getChainLabel);
  if (labels.length === 0) return "supported network";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels.at(-1)}`;
}

export function formatSupportedDashboardChainLabels(): string {
  return formatChainLabels(ALL_SUPPORTED);
}

export function formatChainLabelsForEnvironment(mode: EnvironmentMode): string {
  return formatChainLabels(getChainIdsForEnvironment(mode));
}

/** Returns whether a chain ID is valid for the given environment mode. */
export function isChainAllowedForEnvironment(
  chainId: unknown,
  mode: EnvironmentMode,
): boolean {
  const numeric = Number(chainId);
  if (!Number.isInteger(numeric)) return false;
  const allowed = getChainIdsForEnvironment(mode);
  return (allowed as readonly number[]).includes(numeric);
}

export const SUPPORTED_DASHBOARD_CHAIN_LABEL =
  formatSupportedDashboardChainLabels();
