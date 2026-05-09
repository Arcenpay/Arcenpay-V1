import {
  getPrimaryRuntimeChainProfile,
} from "@arcenpay/internal-core";

export const RUNTIME_CHAIN_PROFILE = getPrimaryRuntimeChainProfile();
export const RUNTIME_CHAIN_ID = RUNTIME_CHAIN_PROFILE.chainId;

export function hasConfiguredBaseSepoliaSubgraph(): boolean {
  return RUNTIME_CHAIN_PROFILE.subgraphEnvKeys.some((key) => {
    const value = process.env[key]?.trim();
    return Boolean(value);
  });
}
