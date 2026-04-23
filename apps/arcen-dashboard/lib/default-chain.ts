const SUPPORTED_CHAIN_IDS = [11155111, 84532, 8453] as const;

export type SupportedDashboardChainId = (typeof SUPPORTED_CHAIN_IDS)[number];
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

const SUPPORTED_CHAIN_ID_SET = new Set<number>(SUPPORTED_CHAIN_IDS);
const TESTNET_CHAIN_ID_SET = new Set<number>([11155111, 84532]);
const MAINNET_CHAIN_ID_SET = new Set<number>([1, 8453]);

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
  ) ?? 84532;

export const DEFAULT_TESTNET_CHAIN_ID: SupportedDashboardChainId =
  TESTNET_CHAIN_ID_SET.has(DEFAULT_CHAIN_ID) ? DEFAULT_CHAIN_ID : 84532;

export const DEFAULT_PRODUCTION_CHAIN_ID: SupportedDashboardChainId =
  MAINNET_CHAIN_ID_SET.has(DEFAULT_CHAIN_ID) ? DEFAULT_CHAIN_ID : 8453;

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
  switch (chainId) {
    case 11155111:
      return "Sepolia Testnet";
    case 84532:
      return "Base Sepolia";
    case 8453:
      return "Base Mainnet";
    default:
      return `Chain ${chainId}`;
  }
}
