import { getChainEnvironment } from "./environment";
import { getChain } from "./chains";

export const PRIMARY_RUNTIME_CHAIN_ID = 84532 as const;
export const LEGACY_RUNTIME_CHAIN_IDS = [11155111] as const;

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

export function getPrimaryRuntimeChainProfile(): RuntimeChainProfile {
  const chain = getChain(PRIMARY_RUNTIME_CHAIN_ID);
  const env = getChainEnvironment(PRIMARY_RUNTIME_CHAIN_ID);

  return {
    chainId: PRIMARY_RUNTIME_CHAIN_ID,
    chainName: chain.name,
    blockExplorerName: chain.blockExplorers?.default?.name || "Explorer",
    blockExplorerUrl: chain.blockExplorers?.default?.url || "",
    rpcUrl: env.services.rpcUrl,
    subgraphUrl: env.services.subgraphUrl || "",
    facilitatorUrl: env.services.facilitatorUrl || "",
    rpcEnvKeys: unique([
      "ARCENPAY_RPC_URL_84532",
      "MEAP_RPC_URL_84532",
      "RPC_URL_84532",
      "BASE_SEPOLIA_RPC_URL",
      "ARCENPAY_RPC_URL",
      "MEAP_RPC_URL",
      "RPC_URL",
    ]),
    subgraphEnvKeys: unique([
      "ARCENPAY_SUBGRAPH_URL_84532",
      "MEAP_SUBGRAPH_URL_84532",
      "NEXT_PUBLIC_GRAPH_URL_84532",
      "ARCENPAY_SUBGRAPH_URL",
      "MEAP_SUBGRAPH_URL",
      "NEXT_PUBLIC_GRAPH_URL",
    ]),
    facilitatorEnvKeys: unique([
      "ARCENPAY_FACILITATOR_URL_84532",
      "MEAP_FACILITATOR_URL_84532",
      "FACILITATOR_BASE_URL_84532",
      "FACILITATOR_URL_84532",
      "NEXT_PUBLIC_FACILITATOR_BASE_URL_84532",
      "NEXT_PUBLIC_FACILITATOR_URL_84532",
      "ARCENPAY_FACILITATOR_URL",
      "MEAP_FACILITATOR_URL",
      "FACILITATOR_BASE_URL",
      "FACILITATOR_URL",
      "NEXT_PUBLIC_FACILITATOR_BASE_URL",
      "NEXT_PUBLIC_FACILITATOR_URL",
    ]),
    dashboardChainEnvKeys: unique([
      "MEAP_DEFAULT_CHAIN_ID",
      "CHAIN_ID",
      "NEXT_PUBLIC_CHAIN_ID",
    ]),
  };
}

export function isPrimaryRuntimeChain(chainId: number): boolean {
  return chainId === PRIMARY_RUNTIME_CHAIN_ID;
}

export function formatRuntimeChainMismatch(input: {
  actualChainId: number;
  expectedChainId?: number;
}): string {
  const expectedChainId = input.expectedChainId ?? PRIMARY_RUNTIME_CHAIN_ID;
  const expected = getChain(expectedChainId);
  const actual = getChain(input.actualChainId);
  return `${actual.name} (${input.actualChainId}) is active, but the product is configured for ${expected.name} (${expectedChainId}).`;
}
