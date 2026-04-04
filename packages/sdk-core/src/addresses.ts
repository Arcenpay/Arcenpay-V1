// ============================================================
//  @arcenpay/sdk — Contract Addresses
//  Deployed contract address registry per network
//
//  Runtime override: set ARCENPAY_CONTRACT_<chainId>_<key> to inject
//  addresses without redeploying the package — e.g.:
//    ARCENPAY_CONTRACT_8453_planFactory=0xAbCd...
//
//  Zero-address guard: calling getContractAddresses() for a chain
//  whose addresses are all zero-address placeholders throws in
//  NODE_ENV=production so misconfigured deployments fail fast.
// ============================================================

import type { ContractAddresses } from './types';

// --- Contract Addresses per Chain ---
const ADDRESSES: Record<number, ContractAddresses> = {
  // Sepolia Testnet (Primary Dev Network) — Deployed 2026-04-04
  11155111: {
    subscriptionRegistry: '0x408AFd0a6D361f2641B10689Bdf1b5a6B618110b',
    autopayModule: '0x47bD0c50B9F667F75d7B721E12728E9DCA52656E',
    planFactory: '0xcc421b4524b3B54AF5f3A4cd74C2Ab413eDcEEF9',
    feeCollector: '0x3F91d3bC66F01c0bf19cd8830C5C554878d56B16',
    sessionVault: '0xdb0E8beD83e2A0131E7d1FA90AFf6505A9af62c0',
    zkUsageVerifier: '0x643e5c91fbC73ab4e81d788786cd9d4aCb36dD8A',
    mirrorRegistry: '0xea80D978dbc8DBB08B45C2754214de7f96755f33',
  },
  // Base Sepolia (Testnet) — set ARCENPAY_CONTRACT_84532_* env vars after deployment
  84532: {
    subscriptionRegistry: '0x0000000000000000000000000000000000000000',
    autopayModule: '0x0000000000000000000000000000000000000000',
    planFactory: '0x0000000000000000000000000000000000000000',
    feeCollector: '0x0000000000000000000000000000000000000000',
    sessionVault: '0x0000000000000000000000000000000000000000',
    zkUsageVerifier: '0x0000000000000000000000000000000000000000',
    mirrorRegistry: '0x0000000000000000000000000000000000000000',
  },
  // Base Mainnet — set ARCENPAY_CONTRACT_8453_* env vars after audit + deployment
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
 * Applies ARCENPAY_CONTRACT_<chainId>_<key> (or legacy MEAP_CONTRACT_<chainId>_<key>) env var
 * overrides to a base addresses object.
 * This allows injecting deployed addresses for new chains without redeploying the package.
 */
function applyEnvOverrides(chainId: number, base: ContractAddresses): ContractAddresses {
  if (typeof process === 'undefined') return base;
  const result = { ...base };
  for (const key of CONTRACT_KEYS) {
    // Check new prefix first, fall back to legacy MEAP_ prefix
    const envKey = `ARCENPAY_CONTRACT_${chainId}_${key}`;
    const legacyKey = `MEAP_CONTRACT_${chainId}_${key}`;
    const override = process.env[envKey] ?? process.env[legacyKey];
    if (override && override.startsWith('0x')) {
      (result as unknown as Record<string, string>)[key] = override;
    }
  }
  // optional extension contracts
  const mirrorOverride = process.env[`ARCENPAY_CONTRACT_${chainId}_mirrorRegistry`] ?? process.env[`MEAP_CONTRACT_${chainId}_mirrorRegistry`];
  if (mirrorOverride && mirrorOverride.startsWith('0x')) {
    result.mirrorRegistry = mirrorOverride;
  }
  const yieldOverride = process.env[`ARCENPAY_CONTRACT_${chainId}_yieldSessionVault`] ?? process.env[`MEAP_CONTRACT_${chainId}_yieldSessionVault`];
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
          `Set ARCENPAY_CONTRACT_${chainId}_<key> env vars or deploy contracts before using this chain in production.`,
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
