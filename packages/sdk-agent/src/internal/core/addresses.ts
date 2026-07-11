// ============================================================
//  ArcenPay Internal Core — Contract Addresses
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
  // Ethereum Sepolia (Testnet) — Deployed 2026-03-19
  11155111: {
    subscriptionRegistry: '0xE206C519076535A9d24c852093860CFD780908C1',
    autopayModule: '0xc82417e378b23AD9Ae73229EF08a4BA7896a4351',
    planFactory: '0x4F97E0c2Ac053b735640fEb164a08Cb45ba83db1',
    feeCollector: '0xa8A0D3007e5680D387A50C1a1E2Eb0AD092ca396',
    sessionVault: '0xd68b9C0a34d61CC3b3F982A5EC6Cc5a5739e46D9',
    zkUsageVerifier: '0x1f75d66692416cE880d51Baf6CdcBeE98E5837c0',
    mirrorRegistry: '0xC187CD32d569ec0E84B9b378f8E63f3a74afac74',
  },
  // Base Sepolia (Testnet) — Deployed 2026-05-16
  84532: {
    subscriptionRegistry: '0xC2faa4DD73B2F449b6db1A661cC8C7C271187007',
    autopayModule: '0xE8FFF520331E2ce6d75B5b57385e4ab15Cd3ae43',
    planFactory: '0x59b15e1d4882A4CaAD475097549dF94fE336a421',
    feeCollector: '0x6450DD859035405D892793F4a6D0BE780f9bBfEe',
    sessionVault: '0x9dF25216eaB5766414414C07E28Fba4f89b4b24B',
    zkUsageVerifier: '0x613D16B414a6428aE07A712039DE764245Eb14Ac',
    mirrorRegistry: '0xC24cBC9C664aCA41dEf6D5a3E941c1e11C163fD1',
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
  // Arc Testnet (Testnet) — Deployed 2026-07-08 12:51 UTC
  5042002: {
    subscriptionRegistry: '0x6F590e66B83D8A29A106C1274D6CB66DAc1666F7',
    autopayModule: '0xF18E8F80e4E917912235e035999E49c7B429608b',
    planFactory: '0xD9cbc3479557cC3C41Cc23c5bbAC17697b122e25',
    feeCollector: '0x6CF2777Ed84ae15D5814CE7022b546dE2e55301a',
    sessionVault: '0x84f973E334034f8f6b821a8E4c0Ec2f8Df238b33',
    zkUsageVerifier: '0x6404826D859efF7fcaef26F316dD55C0e83E0418',
    mirrorRegistry: '0xE4b4820058a351cD21d208605F2c44715DB424Ab',
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
