// ============================================================
//  @meap/core — Contract Addresses
//  Deployed contract address registry per network
// ============================================================

import type { ContractAddresses } from './types';

// --- Contract Addresses per Chain ---
const ADDRESSES: Record<number, ContractAddresses> = {
  // Sepolia Testnet (Primary Dev Network) — Deployed 2026-02-25
  11155111: {
    subscriptionRegistry: '0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A',
    autopayModule: '0x3f3734fb45D1511c23384D18Eb1927492E5e3764',
    planFactory: '0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6',
    feeCollector: '0x513fab5218045790364b33A38D95FE8E17403BAe',
    sessionVault: '0x2dccEaad8551a620E4Fc736bb4d0fbb8D1A17D7C',
    zkUsageVerifier: '0x265E0dC80b00044d183AFa83237F5976bB4d585c',
    mirrorRegistry: '0x05BdaB1b4A87a4a5DF3Af1Ebb9Da853A0d31592E',
  },
  // Base Sepolia (Testnet) — future deployment
  84532: {
    subscriptionRegistry: '0x0000000000000000000000000000000000000000',
    autopayModule: '0x0000000000000000000000000000000000000000',
    planFactory: '0x0000000000000000000000000000000000000000',
    feeCollector: '0x0000000000000000000000000000000000000000',
    sessionVault: '0x0000000000000000000000000000000000000000',
    zkUsageVerifier: '0x0000000000000000000000000000000000000000',
  },
  // Base Mainnet — populated after audit + mainnet deployment
  8453: {
    subscriptionRegistry: '0x0000000000000000000000000000000000000000',
    autopayModule: '0x0000000000000000000000000000000000000000',
    planFactory: '0x0000000000000000000000000000000000000000',
    feeCollector: '0x0000000000000000000000000000000000000000',
    sessionVault: '0x0000000000000000000000000000000000000000',
    zkUsageVerifier: '0x0000000000000000000000000000000000000000',
  },
};

/**
 * Returns contract addresses for a given chain
 * @param chainId - The chain ID
 * @returns Contract addresses for the chain
 */
export function getContractAddresses(chainId: number): ContractAddresses {
  const addresses = ADDRESSES[chainId];
  if (!addresses) {
    throw new Error(`No contract addresses configured for chain ${chainId}`);
  }
  return addresses;
}

/**
 * Updates contract addresses (used in tests and after deployment)
 */
export function setContractAddresses(chainId: number, addresses: Partial<ContractAddresses>): void {
  ADDRESSES[chainId] = {
    ...ADDRESSES[chainId],
    ...addresses,
  } as ContractAddresses;
}
