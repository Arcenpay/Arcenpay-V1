import {
  getContractAddresses,
  TOKENS,
  parseContractError as parseCoreContractError,
} from "@meap/core";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || "11155111");
export const CONTRACTS = getContractAddresses(CHAIN_ID);
export const USDC_ADDRESS = TOKENS[CHAIN_ID as keyof typeof TOKENS]
  ?.USDC as `0x${string}`;
export const FACILITATOR_BASE_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL || "http://localhost:3402";

export const DASHBOARD_ERRORS: Record<string, string> = {
  "PlanFactory: not a provider":
    "Your wallet is not registered as a provider. Contact the protocol admin.",
  "PlanFactory: price must be > 0": "Plan price must be greater than zero.",
  "PlanFactory: interval must be >= 30 days":
    "Billing interval must be at least 30 days.",
  "PlanFactory: token not approved":
    "The selected payment token is not approved by the protocol.",
  "PlanFactory: empty name": "Plan name cannot be empty.",
  "PlanFactory: already registered":
    "This address is already registered as a provider.",
  NotSubscribed: "Your wallet does not have an active subscription.",
  PlanNotFound: "This plan no longer exists or has been deactivated.",
  InsufficientBalance:
    "Your session vault balance is too low. Please deposit more USDC.",
  ModuleAlreadyInstalled: "Autopay is already set up for this provider.",
  NullifierUsed: "This usage proof has already been submitted.",
};

export function parseContractError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [key, readable] of Object.entries(DASHBOARD_ERRORS)) {
    if (message.includes(key)) return readable;
  }
  return parseCoreContractError(error);
}

export function getExplorerUrl(
  hashOrAddress: string,
  chainId: number = CHAIN_ID,
  type: "tx" | "address" = "tx",
): string {
  const explorers: Record<number, string> = {
    11155111: "https://sepolia.etherscan.io",
    84532: "https://sepolia.basescan.org",
    8453: "https://basescan.org",
  };
  const base = explorers[chainId] || explorers[11155111];
  return `${base}/${type}/${hashOrAddress}`;
}

export function formatUSDC(value: bigint): string {
  return (Number(value) / 1e6).toFixed(2);
}

export function formatInterval(seconds: number): string {
  if (seconds >= 31536000) return "Annually";
  if (seconds >= 7776000) return "Quarterly";
  if (seconds >= 2592000) return "Monthly";
  return `${Math.floor(seconds / 86400)} days`;
}

export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
