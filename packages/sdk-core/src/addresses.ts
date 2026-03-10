// ============================================================
//  @meap/core — Contract Addresses
//  Deployed contract address registry per network
//
//  Runtime override: set MEAP_CONTRACT_<chainId>_<key> to inject
//  addresses without redeploying the package — e.g.:
//    MEAP_CONTRACT_8453_planFactory=0xAbCd...
//
//  Zero-address guard: calling getContractAddresses() for a chain
//  whose addresses are all zero-address placeholders throws in
//  NODE_ENV=production so misconfigured deployments fail fast.
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
  // Base Sepolia (Testnet) — set MEAP_CONTRACT_84532_* env vars after deployment
  84532: {
    subscriptionRegistry: '0x0000000000000000000000000000000000000000',
    autopayModule: '0x0000000000000000000000000000000000000000',
    planFactory: '0x0000000000000000000000000000000000000000',
    feeCollector: '0x0000000000000000000000000000000000000000',
    sessionVault: '0x0000000000000000000000000000000000000000',
    zkUsageVerifier: '0x0000000000000000000000000000000000000000',
    mirrorRegistry: '0x0000000000000000000000000000000000000000',
  },
  // Base Mainnet — set MEAP_CONTRACT_8453_* env vars after audit + deployment
  8453: {
    subscriptionRegistry: '0x0000000000000000000000000000000000000000',
    autopayModule: '0x0000000000000000000000000000000000000000',
    planFactory: '0x0000000000000000000000000000000000000000',
    feeCollector: '0x0000000000000000000000000000000000000000',
    sessionVault: '0x0000000000000000000000000000000000000000',
    zkUsageVerifier: '0x0000000000000000000000000000000000000000',
    mirrorRegistry: '0x0000000000000000000000000000000000000000',
  },
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const CONTRACT_KEYS: (keyof ContractAddresses)[] = [
  'subscriptionRegistry',
  'autopayModule',
  'planFactory',
  'feeCollector',
  'sessionVault',
  'zkUsageVerifier',
];

/**
 * Applies MEAP_CONTRACT_<chainId>_<key> env var overrides to a base addresses object.
 * This allows injecting deployed addresses for new chains without redeploying the package.
 */
function applyEnvOverrides(chainId: number, base: ContractAddresses): ContractAddresses {
  if (typeof process === 'undefined') return base;
  const result = { ...base };
  for (const key of CONTRACT_KEYS) {
    const envKey = `MEAP_CONTRACT_${chainId}_${key}`;
    const override = process.env[envKey];
    if (override && override.startsWith('0x')) {
      (result as unknown as Record<string, string>)[key] = override;
    }
  }
  // optional extension contracts — check separately
  const mirrorOverride = process.env[`MEAP_CONTRACT_${chainId}_mirrorRegistry`];
  if (mirrorOverride && mirrorOverride.startsWith('0x')) {
    result.mirrorRegistry = mirrorOverride;
  }
  const yieldOverride = process.env[`MEAP_CONTRACT_${chainId}_yieldSessionVault`];
  if (yieldOverride && yieldOverride.startsWith('0x')) {
    result.yieldSessionVault = yieldOverride;
  }
  return result;
}

/**
 * Returns contract addresses for a given chain.
 *
 * In NODE_ENV=production, throws if all core contract addresses are still
 * zero-address placeholders — the chain has not been deployed to.
 *
 * @param chainId - The chain ID
 * @returns Contract addresses for the chain, with any env var overrides applied
 */
export function getContractAddresses(chainId: number): ContractAddresses {
  const base = ADDRESSES[chainId];
  if (!base) {
    throw new Error(`No contract addresses configured for chain ${chainId}`);
  }

  const addresses = applyEnvOverrides(chainId, base);

  // In production, reject chains with only zero-address placeholders.
  // A chain is considered undeployed if ALL core contracts are zero.
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    const allZero = CONTRACT_KEYS.every(
      (k) => (addresses as unknown as Record<string, string>)[k] === ZERO_ADDRESS,
    );
    if (allZero) {
      throw new Error(
        `[getContractAddresses] Chain ${chainId} has no deployed contracts. ` +
          `Set MEAP_CONTRACT_${chainId}_<key> env vars or deploy contracts before using this chain in production.`,
      );
    }
  }

  return addresses;
}

/**
 * Updates contract addresses (used in tests and after deployment).
 */
export function setContractAddresses(chainId: number, addresses: Partial<ContractAddresses>): void {
  ADDRESSES[chainId] = {
    ...ADDRESSES[chainId],
    ...addresses,
  } as ContractAddresses;
}
