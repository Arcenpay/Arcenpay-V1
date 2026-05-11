import { getChain, getConfiguredRuntimeChainId } from "@arcenpay/internal-core";

export const SEPOLIA_CHAIN_ID = 11155111 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;

const SUPPORTED_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID, ARC_TESTNET_CHAIN_ID] as const;

export type SupportedDashboardChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

const SUPPORTED_CHAIN_ID_SET = new Set<number>(SUPPORTED_CHAIN_IDS);
const TESTNET_CHAIN_ID_SET = new Set<number>([BASE_SEPOLIA_CHAIN_ID, ARC_TESTNET_CHAIN_ID]);

function parseChainId(value: unknown): SupportedDashboardChainId | null {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return null;
  return SUPPORTED_CHAIN_ID_SET.has(numeric)
    ? (numeric as SupportedDashboardChainId)
    : null;
}

export function isSupportedDashboardChainId(
  value: unknown,
): value is SupportedDashboardChainId {
  return parseChainId(value) !== null;
}

export const DEFAULT_CHAIN_ID: SupportedDashboardChainId =
  parseChainId(getConfiguredRuntimeChainId()) ?? ARC_TESTNET_CHAIN_ID;

export const DEFAULT_TESTNET_CHAIN_ID: SupportedDashboardChainId =
  TESTNET_CHAIN_ID_SET.has(DEFAULT_CHAIN_ID)
    ? DEFAULT_CHAIN_ID
    : BASE_SEPOLIA_CHAIN_ID;

export const DEFAULT_PRODUCTION_CHAIN_ID: SupportedDashboardChainId =
  DEFAULT_CHAIN_ID;

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
  if (explicit) return explicit;
  return environmentMode === "PRODUCTION"
    ? DEFAULT_PRODUCTION_CHAIN_ID
    : DEFAULT_TESTNET_CHAIN_ID;
}

export function getChainLabel(chainId: number): string {
  try {
    return getChain(chainId).name;
  } catch {
    return `Chain ${chainId}`;
  }
}
