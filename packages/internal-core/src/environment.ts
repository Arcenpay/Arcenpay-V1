// ============================================================
//  ArcenPay Internal Core — Shared Environment Manifest
//  Single source of truth for chain contracts + service URLs.
// ============================================================

import type {
  ChainEnvironmentManifest,
  ChainServiceEndpoints,
  ContractAddresses,
  EnvironmentManifest,
} from "./types";
import { getChain } from "./chains";
import { getContractAddresses } from "./addresses";

export const ENVIRONMENT_MANIFEST_VERSION = "2026-03-09.1";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const REQUIRED_CONTRACT_KEYS: (keyof ContractAddresses)[] = [
  "subscriptionRegistry",
  "autopayModule",
  "planFactory",
  "feeCollector",
  "sessionVault",
  "zkUsageVerifier",
];

const DEFAULT_SERVICES: Record<number, ChainServiceEndpoints> = {
  11155111: {
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
  },
  84532: {
    rpcUrl: "https://sepolia.base.org",
  },
  8453: {
    rpcUrl: "https://mainnet.base.org",
  },
};

type ServiceKey = keyof ChainServiceEndpoints;

const LEGACY_RPC_ENV_KEYS: Record<number, string[]> = {
  11155111: ["SEPOLIA_RPC_URL"],
  84532: ["BASE_SEPOLIA_RPC_URL"],
  8453: ["BASE_MAINNET_RPC_URL"],
};

const SERVICE_ENV_KEYS: Record<ServiceKey, (chainId: number) => string[]> = {
  rpcUrl: (chainId) => [
    `ARCENPAY_RPC_URL_${chainId}`,
    `MEAP_RPC_URL_${chainId}`,
    `RPC_URL_${chainId}`,
    `NEXT_PUBLIC_RPC_URL_${chainId}`,
    ...(LEGACY_RPC_ENV_KEYS[chainId] || []),
    "ARCENPAY_RPC_URL",
    "MEAP_RPC_URL",
    "RPC_URL",
    "NEXT_PUBLIC_RPC_URL",
  ],
  subgraphUrl: (chainId) => [
    `ARCENPAY_SUBGRAPH_URL_${chainId}`,
    `MEAP_SUBGRAPH_URL_${chainId}`,
    `NEXT_PUBLIC_GRAPH_URL_${chainId}`,
    "ARCENPAY_SUBGRAPH_URL",
    "MEAP_SUBGRAPH_URL",
    "NEXT_PUBLIC_GRAPH_URL",
  ],
  facilitatorUrl: (chainId) => [
    `ARCENPAY_FACILITATOR_URL_${chainId}`,
    `MEAP_FACILITATOR_URL_${chainId}`,
    `FACILITATOR_BASE_URL_${chainId}`,
    `FACILITATOR_URL_${chainId}`,
    `NEXT_PUBLIC_FACILITATOR_BASE_URL_${chainId}`,
    `NEXT_PUBLIC_FACILITATOR_URL_${chainId}`,
    "ARCENPAY_FACILITATOR_URL",
    "MEAP_FACILITATOR_URL",
    "FACILITATOR_BASE_URL",
    "FACILITATOR_URL",
    "NEXT_PUBLIC_FACILITATOR_BASE_URL",
    "NEXT_PUBLIC_FACILITATOR_URL",
  ],
};

function getEnv(keys: string[]): string | undefined {
  if (typeof process === "undefined") return undefined;
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function resolveServiceUrl(
  chainId: number,
  service: ServiceKey,
  fallback?: string,
): string {
  return getEnv(SERVICE_ENV_KEYS[service](chainId)) || fallback || "";
}

export function isZeroAddress(value: string | undefined | null): boolean {
  return (value || "").toLowerCase() === ZERO_ADDRESS;
}

export function getChainEnvironment(chainId: number): ChainEnvironmentManifest {
  const chain = getChain(chainId);
  const defaults = DEFAULT_SERVICES[chainId] || {
    rpcUrl: chain.rpcUrls.default.http[0] || "",
  };

  return {
    chainId,
    chainName: chain.name,
    isTestnet: Boolean(chain.testnet),
    contracts: getContractAddresses(chainId),
    services: {
      rpcUrl: resolveServiceUrl(chainId, "rpcUrl", defaults.rpcUrl),
      subgraphUrl: resolveServiceUrl(chainId, "subgraphUrl", defaults.subgraphUrl),
      facilitatorUrl: resolveServiceUrl(
        chainId,
        "facilitatorUrl",
        defaults.facilitatorUrl,
      ),
    },
  };
}

export function getEnvironmentManifest(chainIds?: number[]): EnvironmentManifest {
  const selected = chainIds && chainIds.length > 0 ? chainIds : [11155111, 84532, 8453];
  const chains: Record<number, ChainEnvironmentManifest> = {};
  for (const chainId of selected) {
    chains[chainId] = getChainEnvironment(chainId);
  }
  return {
    manifestVersion: ENVIRONMENT_MANIFEST_VERSION,
    chains,
  };
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export interface ValidateChainEnvironmentOptions {
  production?: boolean;
  requiredServices?: ServiceKey[];
  requiredContracts?: (keyof ContractAddresses)[];
}

export function validateChainEnvironment(
  chainId: number,
  options: ValidateChainEnvironmentOptions = {},
): { ok: true } {
  const env = getChainEnvironment(chainId);
  const production =
    options.production ??
    (typeof process !== "undefined" ? process.env.NODE_ENV === "production" : false);

  const requiredContracts = options.requiredContracts || REQUIRED_CONTRACT_KEYS;
  const requiredServices = options.requiredServices || ["rpcUrl"];

  const contractErrors = requiredContracts
    .filter((key) => isZeroAddress(env.contracts[key]))
    .map((key) => `${String(key)} is zero-address`);
  if (production && contractErrors.length > 0) {
    throw new Error(
      `[validateChainEnvironment] Chain ${chainId} invalid contracts: ${contractErrors.join(", ")}`,
    );
  }

  const serviceErrors = requiredServices
    .filter((key) => !env.services[key] || !isValidHttpUrl(env.services[key] || ""))
    .map((key) => `${String(key)} is missing or invalid`);
  if (serviceErrors.length > 0) {
    throw new Error(
      `[validateChainEnvironment] Chain ${chainId} invalid services: ${serviceErrors.join(", ")}`,
    );
  }

  return { ok: true };
}
