import {
  PRIMARY_RUNTIME_CHAIN_ID,
  formatRuntimeChainMismatch,
  getPrimaryRuntimeChainProfile,
  getChain,
} from "@arcenpay/sdk";

export const RUNTIME_CHAIN_ID = PRIMARY_RUNTIME_CHAIN_ID;
export const RUNTIME_CHAIN_PROFILE = getPrimaryRuntimeChainProfile();

export function getRuntimeChainWarning(input: {
  actualChainId: number;
  expectedChainId?: number;
}): string {
  const expectedChainId = input.expectedChainId ?? RUNTIME_CHAIN_ID;
  const expectedChain = getChain(expectedChainId);
  const actualChain = getChain(input.actualChainId);
  return `${formatRuntimeChainMismatch({
    actualChainId: input.actualChainId,
    expectedChainId,
  })} Update ${RUNTIME_CHAIN_PROFILE.dashboardChainEnvKeys.join(", ")} to ${expectedChainId} and run the facilitator with CHAIN_ID=${expectedChainId} plus a Base Sepolia RPC (${RUNTIME_CHAIN_PROFILE.rpcEnvKeys.join(", ")}).`;
}

export function hasConfiguredBaseSepoliaSubgraph(): boolean {
  return RUNTIME_CHAIN_PROFILE.subgraphEnvKeys.some((key) => {
    const value = process.env[key]?.trim();
    return Boolean(value);
  });
}
