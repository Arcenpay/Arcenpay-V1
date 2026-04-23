export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

const SUPPORTED_CHAIN_IDS = [BASE_SEPOLIA_CHAIN_ID] as const;

export type SupportedDashboardChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

const SUPPORTED_CHAIN_ID_SET = new Set<number>(SUPPORTED_CHAIN_IDS);
const TESTNET_CHAIN_ID_SET = new Set<number>([BASE_SEPOLIA_CHAIN_ID]);

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
  parseChainId(
    process.env.MEAP_DEFAULT_CHAIN_ID ||
      process.env.CHAIN_ID ||
      process.env.NEXT_PUBLIC_CHAIN_ID,
  ) ?? BASE_SEPOLIA_CHAIN_ID;

export const DEFAULT_TESTNET_CHAIN_ID: SupportedDashboardChainId =
  TESTNET_CHAIN_ID_SET.has(DEFAULT_CHAIN_ID)
    ? DEFAULT_CHAIN_ID
    : BASE_SEPOLIA_CHAIN_ID;

export const DEFAULT_PRODUCTION_CHAIN_ID: SupportedDashboardChainId =
  BASE_SEPOLIA_CHAIN_ID;

export function normalizeEnvironmentMode(_: unknown): EnvironmentMode {
  return "DEVELOPMENT";
}

export function resolveEnvironmentChainId(
  _environmentMode: EnvironmentMode,
  requestedChainId?: unknown,
): SupportedDashboardChainId {
  const explicit = parseChainId(requestedChainId);
  if (explicit) return explicit;
  return DEFAULT_TESTNET_CHAIN_ID;
}

export function getChainLabel(chainId: number): string {
  switch (chainId) {
    case BASE_SEPOLIA_CHAIN_ID:
      return "Base Sepolia";
    default:
      return `Chain ${chainId}`;
  }
}
