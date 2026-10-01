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
import {
  getChainDescriptor,
  getChainFamily,
  getSolanaRpcUrl,
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
  isUnsetAddressForChain,
  getAllRegisteredChainIds,
} from "./chain-family";

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
    rpcUrl: "https://base-sepolia-rpc.publicnode.com",
  },
  8453: {
    rpcUrl: "https://mainnet.base.org",
  },
  5042002: {
    rpcUrl: "https://rpc.testnet.arc.network",
  },
  // WARNING: BOT Chain's own docs state `eth_getLogs` is DISABLED on this
  // default public Mainnet endpoint. The facilitator's event pipeline
  // (EventListenerService) depends entirely on getLogs polling — billing
  // events will silently never arrive against this default. This default
  // exists only so the SDK/manifest has *a* value; production facilitator
  // deployments MUST override via ARCENPAY_RPC_URL_677 / RPC_URL_677 with a
  // getLogs-capable provider before going live.
  677: {
    rpcUrl: "https://rpc.botchain.ai",
  },
  968: {
    rpcUrl: "https://rpc.bohr.life",
  },
};

type ServiceKey = keyof ChainServiceEndpoints;

const LEGACY_RPC_ENV_KEYS: Record<number, string[]> = {
  11155111: ["MEAP_RPC_URL_11155111", "SEPOLIA_RPC_URL"],
  84532: ["MEAP_RPC_URL_84532", "BASE_SEPOLIA_RPC_URL"],
  8453: ["MEAP_RPC_URL_8453", "BASE_MAINNET_RPC_URL"],
  5042002: ["MEAP_RPC_URL_5042002", "ARC_RPC_URL", "ARC_SEPOLIA_RPC_URL"],
  677: ["BOT_MAINNET_RPC_URL"],
  968: ["BOT_TESTNET_RPC_URL"],
};

const SERVICE_ENV_KEYS: Record<ServiceKey, (chainId: number) => string[]> = {
  rpcUrl: (chainId) => [
    `ARCENPAY_RPC_URL_${chainId}`,
    `RPC_URL_${chainId}`,
    `NEXT_PUBLIC_ARCENPAY_RPC_URL_${chainId}`,
    `NEXT_PUBLIC_RPC_URL_${chainId}`,
    ...(LEGACY_RPC_ENV_KEYS[chainId] || []),
    "ARCENPAY_RPC_URL",
    "RPC_URL",
    "NEXT_PUBLIC_ARCENPAY_RPC_URL",
    "NEXT_PUBLIC_RPC_URL",
  ],
  sorobanRpcUrl: (chainId) => [
    `ARCENPAY_STELLAR_RPC_URL_${chainId}`,
    `STELLAR_RPC_URL_${chainId}`,
    "STELLAR_RPC_URL",
  ],
  solanaRpcUrl: (chainId) => [
    `ARCENPAY_SOLANA_RPC_URL_${chainId}`,
    `SOLANA_RPC_URL_${chainId}`,
    "SOLANA_RPC_URL",
  ],
  subgraphUrl: (chainId) => [
    `ARCENPAY_SUBGRAPH_URL_${chainId}`,
    `GRAPH_URL_${chainId}`,
    `NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_${chainId}`,
    `NEXT_PUBLIC_GRAPH_URL_${chainId}`,
    "ARCENPAY_SUBGRAPH_URL",
    "GRAPH_URL",
    "NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL",
    "NEXT_PUBLIC_GRAPH_URL",
  ],
  facilitatorUrl: (chainId) => [
    `ARCENPAY_FACILITATOR_URL_${chainId}`,
    `FACILITATOR_BASE_URL_${chainId}`,
    `FACILITATOR_URL_${chainId}`,
    `NEXT_PUBLIC_ARCENPAY_FACILITATOR_URL_${chainId}`,
    `NEXT_PUBLIC_FACILITATOR_BASE_URL_${chainId}`,
    `NEXT_PUBLIC_FACILITATOR_URL_${chainId}`,
    "ARCENPAY_FACILITATOR_URL",
    "FACILITATOR_BASE_URL",
    "FACILITATOR_URL",
    "NEXT_PUBLIC_ARCENPAY_FACILITATOR_URL",
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
  const family = getChainFamily(chainId);
  const descriptor = getChainDescriptor(chainId);

  // Non-EVM families (Stellar…) have no viem Chain definition — build the
  // manifest from the CHAIN_REGISTRY descriptor directly.
  if (family !== "evm") {
    if (!descriptor) {
      throw new Error(
        `[getChainEnvironment] No chain descriptor configured for chain ${chainId}`,
      );
    }
    return {
      chainId,
      chainName: descriptor.name,
      isTestnet: Boolean(descriptor.testnet),
      contracts: getContractAddresses(chainId),
      services: {
        rpcUrl:
          family === "solana"
            ? getSolanaRpcUrl(chainId)
            : resolveServiceUrl(chainId, "rpcUrl", descriptor.rpcUrl ?? ""),
        sorobanRpcUrl:
          family === "stellar"
            ? (process.env[`ARCENPAY_STELLAR_RPC_URL_${chainId}`] ??
                process.env[`STELLAR_RPC_URL_${chainId}`] ??
                getStellarSorobanRpcUrl(chainId)) ||
              descriptor.sorobanRpcUrl ||
              ""
            : "",
        solanaRpcUrl:
          family === "solana" ? getSolanaRpcUrl(chainId) : "",
        subgraphUrl: resolveServiceUrl(chainId, "subgraphUrl"),
        facilitatorUrl: resolveServiceUrl(chainId, "facilitatorUrl"),
      },
    };
  }

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
      sorobanRpcUrl: "",
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
  const selected =
    chainIds && chainIds.length > 0 ? chainIds : getAllRegisteredChainIds();
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
    .filter((key) => isUnsetAddressForChain(env.contracts[key], chainId))
    .map((key) => `${String(key)} is unset`);
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
