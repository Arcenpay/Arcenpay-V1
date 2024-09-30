// ============================================================
//  ArcenPay Internal Core — Contract Addresses
//  Deployed contract address registry per network
//
//  Runtime override: set ARCENPAY_CONTRACT_<chainId>_<key> to inject
//  addresses without redeploying the package — e.g.:
//    ARCENPAY_CONTRACT_8453_planFactory=0xAbCd...          (EVM)
//    ARCENPAY_CONTRACT_9000001_subscriptionRegistry=C…      (Stellar)
//
//  Family awareness: EVM contracts use 20-byte hex 0x addresses with the
//  0x000…000 zero-address as the "unset" sentinel. Stellar contracts use
//  56-char C… (contract id) or 64-hex; the "unset" sentinel for Stellar
//  is the empty string. This module rejects only the sentinel that matches
//  the chain's family.
// ============================================================

import type { ContractAddresses } from './types';
import {
  CHAIN_FAMILY_METADATA,
  getChainFamily,
  isUnsetAddressForChain,
  unsetAddressForFamily,
  type ChainFamily,
} from './chain-family';
import {
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
} from './chain-family';

// --- Contract Addresses per Chain ---
//
// For Stellar chains we leave the addresses as "" (family unset sentinel).
// Deployments inject real contract ids via env vars or `setContractAddresses`.
const STELLAR_UNSET = "";

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
  // BOT Chain Mainnet (677) — Deployed 2026-09-05
  677: {
    subscriptionRegistry: '0xea549C49A1A97faC398F977BCC0D65256c5419d9',
    autopayModule: '0xB240841d1c886455aC0620bB0A0AE1C194f3e275',
    planFactory: '0x09fD8422638F4d6eA05F6Dcb2FB15Bea6eC59f41',
    feeCollector: '0x17375ec258cDABEB491AB9ae3F78428BC26Aa382',
    sessionVault: '0x118C32C629F47109CF21a306A72c447127084CF4',
    zkUsageVerifier: '0x0694CB91b9399869ecB5942EF40AbD6C835Ba83a',
    mirrorRegistry: '0xE8E068FC93E9687c7D85d303312Ac13806e73e2F',
  },
  // BOT Chain Testnet (968) — Mock placeholder addresses for staging
  968: {
    subscriptionRegistry: '0x3000000000000000000000000000000000000968',
    autopayModule: '0x6000000000000000000000000000000000000968',
    planFactory: '0x1000000000000000000000000000000000000968',
    feeCollector: '0x2000000000000000000000000000000000000968',
    sessionVault: '0x4000000000000000000000000000000000000968',
    zkUsageVerifier: '0x5000000000000000000000000000000000000968',
    mirrorRegistry: '0x7000000000000000000000000000000000000968',
  },
  // Arc Testnet (Testnet) — Deployed 2026-08-02
  5042002: {
    subscriptionRegistry: '0x4a8B7CE3Fc1c767329c50D9230FA46c2c16df0A9',
    autopayModule: '0x265E0dC80b00044d183AFa83237F5976bB4d585c',
    planFactory: '0xcbFa833217C6B5d4367BD4B344689a14a0658D86',
    feeCollector: '0xCAc7bEE666560066f464A23172789c172b6cd254',
    sessionVault: '0xc736f5d91aC0039b97A4Fc3540B8f3d59E7FdBa6',
    zkUsageVerifier: '0xf45A9E5280F72260a713c50b0Ca4e4FB1e22Cc8A',
    mirrorRegistry: '0x05BdaB1b4A87a4a5DF3Af1Ebb9Da853A0d31592E',
  },

  // ── Stellar Mainnet — synthetic chainId 9_000_000 ──
  // Addresses are C… Soroban contract ids; deploy via env overrides.
  [STELLAR_MAINNET_CHAIN_ID]: {
    subscriptionRegistry: STELLAR_UNSET,
    autopayModule: STELLAR_UNSET, // Stellar analogue: autopay-account
    planFactory: STELLAR_UNSET,
    feeCollector: STELLAR_UNSET,
    sessionVault: STELLAR_UNSET,
    zkUsageVerifier: STELLAR_UNSET,
    mirrorRegistry: STELLAR_UNSET,
  },
// ── Stellar Testnet — synthetic chainId 9_000_001 ──
  // Deployed 2026-08-03, source: GAPTLSU5SPPGZBGS3Y45EJG5U6ZJ7VARO4OLD76TSQGG25RNEFCTG2P3
  [STELLAR_TESTNET_CHAIN_ID]: {
    subscriptionRegistry: "CBNUA7RLTYRKNQVYOCH4IFMLGTLFL56C5NTS5BEWC2AQGYQEQA4BSOOG",
    autopayModule:       "CBIESVR5J3CWARGTUFX5N5B35L6YMW55G7XFLL2H2U3W6ZOH7X6SD657",
    planFactory:         "CAF4VS5OMM6DW5ZN5JFJH4U2RJD6DODZYBHNXMTS6RSUMPDO3T4C73S7",
    feeCollector:        "CCYRIQZNSWWO7KO6ZBA2AU4GAGQHR44ZQO577JYFVFXAHJW6WNB2XL5A",
    sessionVault:        "CCFU6CXODJEGZLKYNSWI4Z5L5CGN7TCVGHZ33IPKPZK6HBXVDZKMVTLY",
    zkUsageVerifier:     "CB5UVWDVPATDHJUKLMJXH5FJRNRDPXENXQYOXTT5FYDOXSJGDPUSIDU6",
    mirrorRegistry:      "CB5GW6VAYJXMRTPKSEIFAJDT2WID2J5PSDLMAFH5LL7IAVQJNMS2OCO2",
  },
  // ── Stellar Futurenet — synthetic chainId 9_000_002 ──
  9000002: {
    subscriptionRegistry: STELLAR_UNSET,
    autopayModule: STELLAR_UNSET,
    planFactory: STELLAR_UNSET,
    feeCollector: STELLAR_UNSET,
    sessionVault: STELLAR_UNSET,
    zkUsageVerifier: STELLAR_UNSET,
    mirrorRegistry: STELLAR_UNSET,
  },

  // ── Solana ──
  // Addresses hold base58 program ids. Deploy via env overrides
  // (ARCENPAY_CONTRACT_<chainId>_<key>) or `setContractAddresses` after the
  // Anchor program is deployed. Empty string is the family "unset" sentinel.
  [SOLANA_MAINNET_CHAIN_ID]: {
    subscriptionRegistry: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    autopayModule: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    planFactory: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    feeCollector: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    sessionVault: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    zkUsageVerifier: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    mirrorRegistry: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
  },
  // ── Solana Devnet — synthetic chainId 9_100_001 ──
  // Deployed 2026-09-30. The ArcenPay Anchor program serves all roles, so
  // every slot holds the same program id.
  [SOLANA_DEVNET_CHAIN_ID]: {
    subscriptionRegistry: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    autopayModule: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    planFactory: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    feeCollector: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    sessionVault: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    zkUsageVerifier: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
    mirrorRegistry: "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3",
  },
  [SOLANA_TESTNET_CHAIN_ID]: {
    subscriptionRegistry: "",
    autopayModule: "",
    planFactory: "",
    feeCollector: "",
    sessionVault: "",
    zkUsageVerifier: "",
    mirrorRegistry: "",
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
 *
 * Family-aware validation:
 *   - EVM: requires value to start with '0x'.
 *   - Stellar: requires value to be non-empty (any string form C… or hex is accepted).
 *
 * This allows injecting deployed addresses for new chains (EVM or otherwise)
 * without redeploying the package.
 */
function applyEnvOverrides(chainId: number, base: ContractAddresses): ContractAddresses {
  if (typeof process === 'undefined') return base;
  const family = getChainFamily(chainId);
  const result = { ...base };
  for (const key of CONTRACT_KEYS) {
    // Check new prefix first, fall back to legacy MEAP_ prefix
    const envKey = `ARCENPAY_CONTRACT_${chainId}_${key}`;
    const legacyKey = `MEAP_CONTRACT_${chainId}_${key}`;
    const override = process.env[envKey] ?? process.env[legacyKey];
    if (override && isAcceptableAddressForFamily(override, family)) {
      (result as unknown as Record<string, string>)[key] = override;
    }
  }
  // optional extension contracts
  const mirrorOverride = process.env[`ARCENPAY_CONTRACT_${chainId}_mirrorRegistry`] ?? process.env[`MEAP_CONTRACT_${chainId}_mirrorRegistry`];
  if (mirrorOverride && isAcceptableAddressForFamily(mirrorOverride, family)) {
    result.mirrorRegistry = mirrorOverride;
  }
  // yieldSessionVault is EVM-only — ignore env overrides for non-EVM chains.
  if (family === 'evm') {
    const yieldOverride = process.env[`ARCENPAY_CONTRACT_${chainId}_yieldSessionVault`] ?? process.env[`MEAP_CONTRACT_${chainId}_yieldSessionVault`];
    if (yieldOverride && isAcceptableAddressForFamily(yieldOverride, family)) {
      result.yieldSessionVault = yieldOverride;
    }
  }
  return result;
}

/** True if `value` is a non-empty, family-appropriate override address. */
function isAcceptableAddressForFamily(
  value: string,
  family: ChainFamily | null,
): boolean {
  if (!value) return false;
  // Unknown family: there is no pattern to validate against, so accept any
  // non-empty override (the empty string is the unset sentinel).
  if (!family) return true;
  // Validate against the family's own address pattern — EVM 20-byte hex,
  // Stellar G…/C…, Solana base58 — instead of accepting any non-empty string.
  return new RegExp(CHAIN_FAMILY_METADATA[family].addressPattern).test(value);
}

/**
 * Returns contract addresses for a given chain.
 *
 * In NODE_ENV=production, throws if all core contract addresses are still
 * the family-appropriate "unset" sentinel — the chain has not been deployed to.
 *
 * @param chainId - The chain ID (EVM real id or Stellar synthetic id)
 * @returns Contract addresses for the chain, with any env var overrides applied
 */
export function getContractAddresses(chainId: number): ContractAddresses {
  const base = ADDRESSES[chainId];
  if (!base) {
    throw new Error(`No contract addresses configured for chain ${chainId}`);
  }

  const addresses = applyEnvOverrides(chainId, base);

  // In production, reject chains with only "unset" sentinel placeholders.
  // A chain is considered undeployed if ALL core contracts are the sentinel.
  if (typeof process !== 'undefined' && process.env.NODE_ENV === 'production') {
    const allUnset = CONTRACT_KEYS.every((k) =>
      isUnsetAddressForChain(
        (addresses as unknown as Record<string, string>)[k],
        chainId,
      ),
    );
    if (allUnset) {
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
