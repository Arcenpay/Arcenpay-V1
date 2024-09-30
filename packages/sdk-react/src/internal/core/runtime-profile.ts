import { getChainEnvironment } from "./environment";
import { getChain, SUPPORTED_CHAIN_IDS } from "./chains";
import { getChainDescriptor, getChainFamily } from "./chain-family";

export const PRIMARY_RUNTIME_CHAIN_ID = 5042002 as const;
export const LEGACY_RUNTIME_CHAIN_IDS = [11155111, 84532] as const;

export type RuntimeChainProfile = {
  chainId: number;
  chainName: string;
  blockExplorerName: string;
  blockExplorerUrl: string;
  rpcUrl: string;
  subgraphUrl: string;
  facilitatorUrl: string;
  rpcEnvKeys: string[];
  subgraphEnvKeys: string[];
  facilitatorEnvKeys: string[];
  dashboardChainEnvKeys: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function parseConfiguredRuntimeChainId(): number | null {
  if (typeof process === "undefined") return null;

  const candidates = [
    process.env.ARCENPAY_DEFAULT_CHAIN_ID,
    process.env.CHAIN_ID,
    process.env.NEXT_PUBLIC_CHAIN_ID,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (
      Number.isInteger(numeric) &&
      SUPPORTED_CHAIN_IDS.includes(numeric as (typeof SUPPORTED_CHAIN_IDS)[number])
    ) {
      return numeric;
    }
  }

  return null;
}

function legacyRpcEnvKeys(chainId: number): string[] {
  switch (chainId) {
    case 11155111:
      return ["MEAP_RPC_URL_11155111", "SEPOLIA_RPC_URL"];
    case 84532:
      return ["MEAP_RPC_URL_84532", "BASE_SEPOLIA_RPC_URL"];
    case 8453:
      return ["MEAP_RPC_URL_8453", "BASE_MAINNET_RPC_URL", "BASE_RPC_URL"];
    case 5042002:
      return ["MEAP_RPC_URL_5042002", "ARC_RPC_URL", "ARC_SEPOLIA_RPC_URL"];
    case 677:
      return ["BOT_MAINNET_RPC_URL"];
    case 968:
      return ["BOT_TESTNET_RPC_URL"];
    default:
      return [];
  }
}

export function getConfiguredRuntimeChainId(): number {
  return parseConfiguredRuntimeChainId() ?? PRIMARY_RUNTIME_CHAIN_ID;
}

export function getPrimaryRuntimeChainProfile(): RuntimeChainProfile {
  const chainId = getConfiguredRuntimeChainId();
  const env = getChainEnvironment(chainId);

  // Non-EVM families (Stellar…) have no viem Chain definition — use the
  // CHAIN_REGISTRY descriptor for explorer/name fields.
  if (getChainFamily(chainId) !== "evm") {
    const descriptor = getChainDescriptor(chainId);
    return {
      chainId,
      chainName: descriptor?.name ?? `Chain ${chainId}`,
      blockExplorerName: descriptor?.blockExplorerUrl ? "Explorer" : "Explorer",
      blockExplorerUrl: descriptor?.blockExplorerUrl ?? "",
      rpcUrl: env.services.rpcUrl,
      subgraphUrl: env.services.subgraphUrl || "",
      facilitatorUrl: env.services.facilitatorUrl || "",
      rpcEnvKeys: unique([
        `ARCENPAY_RPC_URL_${chainId}`,
        `RPC_URL_${chainId}`,
        `ARCENPAY_STELLAR_RPC_URL_${chainId}`,
        `STELLAR_RPC_URL_${chainId}`,
        `ARCENPAY_SOLANA_RPC_URL_${chainId}`,
        `SOLANA_RPC_URL_${chainId}`,
        `NEXT_PUBLIC_ARCENPAY_RPC_URL_${chainId}`,
        `NEXT_PUBLIC_RPC_URL_${chainId}`,
        "ARCENPAY_RPC_URL",
        "RPC_URL",
        "STELLAR_RPC_URL",
        "SOLANA_RPC_URL",
      ]),
      subgraphEnvKeys: unique([
        `ARCENPAY_SUBGRAPH_URL_${chainId}`,
        `GRAPH_URL_${chainId}`,
        `NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_${chainId}`,
        `NEXT_PUBLIC_GRAPH_URL_${chainId}`,
        "ARCENPAY_SUBGRAPH_URL",
        "GRAPH_URL",
      ]),
      facilitatorEnvKeys: unique([
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
      ]),
      dashboardChainEnvKeys: unique([
        "ARCENPAY_DEFAULT_CHAIN_ID",
        "CHAIN_ID",
        "NEXT_PUBLIC_CHAIN_ID",
      ]),
    };
  }

  const chain = getChain(chainId);

  return {
    chainId,
    chainName: chain.name,
    blockExplorerName: chain.blockExplorers?.default?.name || "Explorer",
    blockExplorerUrl: chain.blockExplorers?.default?.url || "",
    rpcUrl: env.services.rpcUrl,
    subgraphUrl: env.services.subgraphUrl || "",
    facilitatorUrl: env.services.facilitatorUrl || "",
    rpcEnvKeys: unique([
      `ARCENPAY_RPC_URL_${chainId}`,
      `RPC_URL_${chainId}`,
      `NEXT_PUBLIC_ARCENPAY_RPC_URL_${chainId}`,
      `NEXT_PUBLIC_RPC_URL_${chainId}`,
      ...legacyRpcEnvKeys(chainId),
      "ARCENPAY_RPC_URL",
      "RPC_URL",
      "NEXT_PUBLIC_ARCENPAY_RPC_URL",
      "NEXT_PUBLIC_RPC_URL",
    ]),
    subgraphEnvKeys: unique([
      `ARCENPAY_SUBGRAPH_URL_${chainId}`,
      `GRAPH_URL_${chainId}`,
      `NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL_${chainId}`,
      `NEXT_PUBLIC_GRAPH_URL_${chainId}`,
      "ARCENPAY_SUBGRAPH_URL",
      "GRAPH_URL",
      "NEXT_PUBLIC_ARCENPAY_SUBGRAPH_URL",
      "NEXT_PUBLIC_GRAPH_URL",
    ]),
    facilitatorEnvKeys: unique([
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
    ]),
    dashboardChainEnvKeys: unique([
      "ARCENPAY_DEFAULT_CHAIN_ID",
      "CHAIN_ID",
      "NEXT_PUBLIC_CHAIN_ID",
    ]),
  };
}

export function isPrimaryRuntimeChain(chainId: number): boolean {
  return chainId === getConfiguredRuntimeChainId();
}

export function formatRuntimeChainMismatch(input: {
  actualChainId: number;
  expectedChainId?: number;
}): string {
  const expectedChainId = input.expectedChainId ?? getConfiguredRuntimeChainId();
  const expectedName =
    getChainDescriptor(expectedChainId)?.name ??
    getChain(expectedChainId).name;
  const actualName =
    getChainDescriptor(input.actualChainId)?.name ??
    getChain(input.actualChainId).name;
  return `${actualName} (${input.actualChainId}) is active, but the product is configured for ${expectedName} (${expectedChainId}).`;
}
