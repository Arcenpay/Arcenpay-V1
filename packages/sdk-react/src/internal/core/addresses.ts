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
  // Base Sepolia (Testnet) — Deployed 2026-04-23
  84532: {
    subscriptionRegistry: '0xF9610c064FFD64255A1d509d17b2Af8733084e50',
    autopayModule: '0x69Ac04bFdC045A99A2D31bb141A74da354a94c19',
    planFactory: '0x66775Af13C63781AAd28203CC5d3E9eE5d5eB83d',
    feeCollector: '0x5F32fBfF19385A78c3F721007758E9924FAD4133',
    sessionVault: '0x96BcE2d49e3e4EddBBF3aa07354E66615BC2623c',
    zkUsageVerifier: '0x03290b6988F87925A4939d974895bC30981aA90D',
    mirrorRegistry: '0xe7E0dFfa82596ee6Ba1755bc25c29376a07236dE',
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
  // Arc Testnet — set ARCENPAY_CONTRACT_5042002_* env vars after deployment
  5042002: {
    subscriptionRegistry: '0xe7E0dFfa82596ee6Ba1755bc25c29376a07236dE',
    autopayModule: '0xC8B9C0986d018509AE4dB507FbE4fBd23DCECCe9',
    planFactory: '0x03290b6988F87925A4939d974895bC30981aA90D',
    feeCollector: '0x69Ac04bFdC045A99A2D31bb141A74da354a94c19',
    sessionVault: '0xd6c90997B4d947548F3D97623ab305461265359D',
    zkUsageVerifier: '0xFEB51A5Eeac4392c2d05C79bc019DDa823911a8a',
    mirrorRegistry: '0x8Cef0cbE0c00BC7a6Be8d47d7d2ce933f895c8f8',
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
