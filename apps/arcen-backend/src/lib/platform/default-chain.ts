import { getChain, getChainDescriptor, getConfiguredRuntimeChainId, STELLAR_MAINNET_CHAIN_ID, STELLAR_TESTNET_CHAIN_ID, STELLAR_FUTURENET_CHAIN_ID, SOLANA_MAINNET_CHAIN_ID, SOLANA_DEVNET_CHAIN_ID, SOLANA_TESTNET_CHAIN_ID } from "@arcenpay/internal-core";

export const SEPOLIA_CHAIN_ID = 11155111 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;
export const BASE_MAINNET_CHAIN_ID = 8453 as const;
export const ARC_TESTNET_CHAIN_ID = 5042002 as const;
export const BOT_MAINNET_CHAIN_ID = 677 as const;
export const BOT_TESTNET_CHAIN_ID = 968 as const;
export { STELLAR_MAINNET_CHAIN_ID, STELLAR_TESTNET_CHAIN_ID, STELLAR_FUTURENET_CHAIN_ID };
export { SOLANA_MAINNET_CHAIN_ID, SOLANA_DEVNET_CHAIN_ID, SOLANA_TESTNET_CHAIN_ID };

// All supported chains (testnet + mainnet) for the backend.
// NOTE: BOT Chain Testnet (968) is intentionally EXCLUDED — its deployment is a
// stub (all-zero addresses), so no usable contracts exist there. Only chains
// with real, deployed contracts are listed below (available whether mainnet or
// testnet).
// NOTE: Solana Devnet (9_100_001) is listed for DEVELOPMENT environments; once
// the Anchor program is deployed to Solana Mainnet Beta, add
// SOLANA_MAINNET_CHAIN_ID here.
export const TESTNET_CHAIN_IDS = [
  BASE_SEPOLIA_CHAIN_ID,
  ARC_TESTNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
] as const;
// Production environments support BOT Chain Mainnet, Stellar Mainnet, and Solana Mainnet Beta.
export const MAINNET_CHAIN_IDS = [
  BOT_MAINNET_CHAIN_ID,
  STELLAR_MAINNET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
] as const;

const ALL_SUPPORTED = [...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS] as const;

export type SupportedDashboardChainId = (typeof ALL_SUPPORTED)[number];
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

const SUPPORTED_CHAIN_ID_SET = new Set<number>(ALL_SUPPORTED);
const TESTNET_CHAIN_ID_SET = new Set<number>(TESTNET_CHAIN_IDS);
const MAINNET_CHAIN_ID_SET = new Set<number>(MAINNET_CHAIN_IDS);

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

export const EVM_AUTH_CHAIN_IDS = [
  1, // Ethereum Mainnet
  8453, // Base Mainnet
  84532, // Base Sepolia
  11155111, // Sepolia
  5042002, // Arc Testnet
  677, // BOT Chain Mainnet
  968, // BOT Chain Testnet
] as const;

export function isSupportedWalletAuthChainId(chainId: unknown): boolean {
  const numeric = Number(chainId);
  if (!Number.isInteger(numeric)) return false;
  return (
    isSupportedDashboardChainId(numeric) ||
    (EVM_AUTH_CHAIN_IDS as readonly number[]).includes(numeric)
  );
}

export const DEFAULT_CHAIN_ID: SupportedDashboardChainId =
  parseChainId(getConfiguredRuntimeChainId()) ?? BOT_MAINNET_CHAIN_ID;

export const DEFAULT_MAINNET_CHAIN_ID: SupportedDashboardChainId = BOT_MAINNET_CHAIN_ID;

export const DEFAULT_PRODUCTION_CHAIN_ID: SupportedDashboardChainId =
  DEFAULT_MAINNET_CHAIN_ID;

export function normalizeEnvironmentMode(value: unknown): EnvironmentMode {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "PRODUCTION") return "PRODUCTION";
  }
  return "DEVELOPMENT";
}

export function getChainIdsForEnvironment(
  mode: EnvironmentMode,
): readonly number[] {
  return mode === "PRODUCTION" ? MAINNET_CHAIN_IDS : TESTNET_CHAIN_IDS;
}

export function resolveEnvironmentChainId(
  environmentMode: EnvironmentMode,
  requestedChainId?: unknown,
): SupportedDashboardChainId | null {
  const explicit = parseChainId(requestedChainId);
  if (explicit) {
    const allowed = getChainIdsForEnvironment(environmentMode);
    if ((allowed as readonly number[]).includes(explicit)) return explicit;
  }
  return environmentMode === "PRODUCTION" ? DEFAULT_MAINNET_CHAIN_ID : null;
}

export function getChainLabel(chainId: number): string {
  // Stellar (and future non-EVM) chains use synthetic chainIds unknown to
  // viem's registry. Resolve via the internal-core descriptor first, then
  // fall back to viem for EVM chains.
  const descriptor = getChainDescriptor(chainId);
  if (descriptor) return descriptor.name;
  try {
    return getChain(chainId).name;
  } catch {
    return `Chain ${chainId}`;
  }
}
