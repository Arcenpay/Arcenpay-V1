// ============================================================
//  ArcenPay Internal Core — Chain Configurations
//  Supported blockchain network definitions with multi-token registry
// ============================================================

import { type Chain, defineChain } from 'viem';

// --- Ethereum Sepolia (Testnet) ---
export const sepolia: Chain = defineChain({
  id: 11155111,
  name: 'Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://ethereum-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'Etherscan', url: 'https://sepolia.etherscan.io' },
  },
  testnet: true,
});

// --- Base Sepolia (Testnet) ---
export const baseSepolia: Chain = defineChain({
  id: 84532,
  name: 'Base Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://base-sepolia-rpc.publicnode.com'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://sepolia.basescan.org' },
  },
  testnet: true,
});

// --- Base Mainnet ---
export const baseMainnet: Chain = defineChain({
  id: 8453,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.base.org'] },
  },
  blockExplorers: {
    default: { name: 'BaseScan', url: 'https://basescan.org' },
  },
});

// --- Arc Testnet ---
export const arcTestnet: Chain = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        // Primary: Arc public node
        'https://rpc.testnet.arc.network',
        // Fallback: Thirdweb
        'https://5042002.rpc.thirdweb.com',
      ],
    },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

// --- BOT Chain Mainnet ---
// EVM-compatible Layer 1 (Parlia/BSC-style consensus). Native gas token is
// BOT (18 decimals) — NOT a stablecoin. See TOKENS below: BOT Chain has no
// canonical USDC; only a bridged USDT exists per BOT Chain's own bridge docs
// (dev-docs.botchain.ai/docs/Bridge/contract-addresses). Confirm the intended
// settlement asset before relying on the USDT entry for real billing.
//
// IMPORTANT: the default public RPC below has `eth_getLogs` DISABLED per
// BOT Chain's own docs (dev-docs.botchain.ai/docs/Developers/json-rpc-endpoint).
// The facilitator's EventListenerService polls via `getLogs` every ~15s —
// billing events will NEVER be detected against this default endpoint.
// Override with a getLogs-capable RPC via ARCENPAY_RPC_URL_677 / RPC_URL_677
// before running the facilitator against BOT Chain Mainnet in production.
export const botMainnet: Chain = defineChain({
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.botchain.ai'] },
  },
  blockExplorers: {
    default: { name: 'BOTScan', url: 'https://scan.botchain.ai' },
  },
});

// --- BOT Chain Testnet ("Bohr") ---
export const botTestnet: Chain = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.bohr.life'] },
  },
  blockExplorers: {
    default: { name: 'BOTScan Testnet', url: 'https://scan.bohr.life' },
  },
  testnet: true,
});

// --- Supported Chains Map ---
//
// EVM chain definitions live above (viem `defineChain`). Non-EVM chains
// (Stellar) do NOT use viem — their identity is defined in chain-family.ts.
// The SUPPORTED_CHAIN_IDS union below is the consolidated list spanning
// ALL families; the synthetic Stellar IDs are re-exported from chain-family.
//
// To add an EVM chain: define it above AND add its id here + to TOKENS.
// To add a non-EVM chain: register it in chain-family.ts CHAIN_REGISTRY
//   AND add its synthetic id here. The viem `Chain` shape is EVM-only, so
// non-EVM chains intentionally do not appear in SUPPORTED_CHAINS (which is
// typed as `Record<…, Chain>`).

import {
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
  isValidAddressForChain,
  normalizeWalletForChain,
} from "./chain-family";

export const SUPPORTED_CHAINS = {
  sepolia,
  baseSepolia,
  baseMainnet,
  arcTestnet,
  botMainnet,
  botTestnet,
} as const;

// EVM-only chainId list (preserved for call sites that genuinely require viem).
export const EVM_SUPPORTED_CHAIN_IDS = [11155111, 84532, 8453, 5042002, 677, 968] as const;

// Consolidated chainId list across all families — the source of truth.
export const SUPPORTED_CHAIN_IDS = [
  ...EVM_SUPPORTED_CHAIN_IDS,
  STELLAR_MAINNET_CHAIN_ID,
  STELLAR_TESTNET_CHAIN_ID,
  STELLAR_FUTURENET_CHAIN_ID,
  SOLANA_MAINNET_CHAIN_ID,
  SOLANA_DEVNET_CHAIN_ID,
  SOLANA_TESTNET_CHAIN_ID,
] as const;

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

// Legacy alias — consumers that only cared about EVM ids can keep using this.
export type EvmSupportedChainId = (typeof EVM_SUPPORTED_CHAIN_IDS)[number];

// ─── Token Registry ──────────────────────────────────────────────────────────

/**
 * Describes a stablecoin / ERC-20 token on a given chain.
 *
 * NOTE: For Stellar, the "address" field holds the SAC issuer account
 * (a G… address for issued assets) or the empty string for the native
 * XLM SAC. The `decimals` field is always 6 for USDC on Stellar (issued
 * by Circle). Use {@link getChainFamily} to interpret the address shape.
 */
export interface TokenInfo {
  readonly address: `0x${string}` | string;
  readonly decimals: number;
}

/**
 * Per-chain registry of well-known tokens.
 *
 * To add a new chain or token, extend this object:
 *   <chainId>: { <SYMBOL>: { address: '0x…', decimals: 6 } }
 */
// Stellar chains don't use viem, but USDC on Stellar is the Circle-issued
// SAC asset (issuer G…, decimals 6). For the synthetic chainId range, the
// address field holds the SAC issuer account (or "" for the native XLM SAC).
// The STELLAR_*_CHAIN_ID constants are imported once at the top of the file
// (next to the SUPPORTED_CHAIN_IDS declaration). We reference them inline.

export const TOKENS = {
  // Ethereum Sepolia
  11155111: {
    USDC: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const, decimals: 6 },
  },
  // Base Sepolia
  84532: {
    USDC: { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, decimals: 6 },
  },
  // Base Mainnet
  8453: {
    USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const, decimals: 6 },
  },
  // Arc Testnet — canonical default USDC.
  5042002: {
    USDC: { address: '0x3600000000000000000000000000000000000000' as const, decimals: 6 },
  },
  // BOT Chain Mainnet — NO USDC exists (only bridged USDT). Uses the official
  // bridged USDT address per dev-docs.botchain.ai/docs/Bridge/contract-addresses.
  // The getUsdcAddress() helper in the backend falls back to USDT for chains
  // that have no native USDC, so existing callers still resolve correctly.
  677: {
    USDT: { address: '0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C' as const, decimals: 6 },
  },
  // BOT Chain Testnet — bridged USDT only (no USDC).
  968: {
    USDT: { address: '0x75edC9335175Fc0552D51D48439F229c10420fe3' as const, decimals: 6 },
  },
  // Stellar Mainnet — Circle USDC (SAC issuer account). Address is the G…
  // issuer; the asset code "USDC" is implied by the symbol key.
  [STELLAR_MAINNET_CHAIN_ID]: {
    USDC: { address: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5REQK4DVZWA' as const, decimals: 6 },
  },
  // Stellar Testnet — test USDC issued by the Stellar testnet issuer.
  // Address verified against Stellar testnet SAC deployment docs.
  [STELLAR_TESTNET_CHAIN_ID]: {
    USDC: { address: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5' as const, decimals: 6 },
  },
  // Solana Mainnet — Circle USDC SPL mint (base58 mint address, 6 decimals).
  [SOLANA_MAINNET_CHAIN_ID]: {
    USDC: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as const, decimals: 6 },
  },
  // Solana Devnet — Circle devnet USDC SPL mint (base58, 6 decimals).
  [SOLANA_DEVNET_CHAIN_ID]: {
    USDC: { address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as const, decimals: 6 },
  },
} as const;

/**
 * Chain-token entries are keyed by [chainId]:{ tokens }.
 * To add a new token (e.g., USDT) for an existing chain, add it under that chainId:
 *
 *   84532: {
 *     USDC: { address: '0x…', decimals: 6 },
 *     USDT: { address: '0x…', decimals: 6 },
 *   },
 */

// ─── Token Helpers ──────────────────────────────────────────────────────────

/** Resolves a token's contract address for the given chain and symbol. */
export function getTokenAddress(
  chainId: number,
  symbol: string,
): string | undefined {
  const tokens = TOKENS[chainId as keyof typeof TOKENS];
  if (!tokens) return undefined;
  const info = (tokens as Record<string, TokenInfo>)[symbol];
  return info?.address;
}

/** Resolves a token's decimals for the given chain and symbol. */
export function getTokenDecimals(chainId: number, symbol: string): number {
  const tokens = TOKENS[chainId as keyof typeof TOKENS];
  if (!tokens) return 6;
  const info = (tokens as Record<string, TokenInfo>)[symbol];
  return info?.decimals ?? 6;
}

/** Returns all token symbols available on a given chain. */
export function getTokensForChain(chainId: number): string[] {
  const tokens = TOKENS[chainId as keyof typeof TOKENS];
  if (!tokens) return [];
  return Object.keys(tokens);
}

/**
 * Resolves a token for a payment/checkout request per chain.
 *
 * Accepts either a raw contract address (EVM 0x… / Stellar G…, C…) or a
 * token symbol ("USDC", "USDT"). Symbols are looked up in the per-chain
 * TOKENS registry. "USDC" falls back to "USDT" on chains without a native
 * USDC deployment (e.g. BOT Chain), mirroring the backend `getUsdcAddress()`.
 *
 * Returns `undefined` when the value cannot be resolved for the given chain.
 */
export function resolveTokenAddress(
  chainId: number,
  symbolOrAddress: string,
): string | undefined {
  const trimmed = symbolOrAddress.trim();
  if (!trimmed) return undefined;

  if (isValidAddressForChain(trimmed, chainId)) {
    return normalizeWalletForChain(trimmed, chainId) ?? undefined;
  }

  const symbol = trimmed.toUpperCase();
  const token = getTokenAddress(chainId, symbol);
  if (token && isValidAddressForChain(token, chainId)) return token;

  // Chains without a native USDC (e.g. BOT Chain) only carry bridged USDT.
  if (symbol === "USDC") {
    const usdt = getTokenAddress(chainId, "USDT");
    if (usdt && isValidAddressForChain(usdt, chainId)) return usdt;
  }

  return undefined;
}

// ─── Chain Helpers ──────────────────────────────────────────────────────────
//
// `CHAIN_MAP` is EVM-only — Stellar chains don't have a viem `Chain`. Call
// sites that need cross-family identity should use `getChainDescriptor` from
// chain-family.ts; `getChain` below throws a clear error for non-EVM ids.

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: baseMainnet,
  5042002: arcTestnet,
  677: botMainnet,
  968: botTestnet,
};

// --- Default Chain ---
export const DEFAULT_CHAIN_ID: SupportedChainId = 5042002; // Arc Testnet is the current default

/**
 * Returns the block explorer transaction URL for a given chainId and tx hash.
 * Works for ALL families via {@link getChainDescriptor}; falls back to "" if
 * the chainId is unknown or the chain has no explorer URL.
 *
 * Note: for EVM this builds `/tx/<hash>` (etherscan style); for Stellar the
 * explorer uses a different path (`/tx/` works on stellar.expert too). If a
 * family-specific path is needed in future, branch on `getChainFamily`.
 */
export function getBlockExplorerUrl(chainId: number, txHash: string): string {
  const descriptor = getChainDescriptorForHosts(chainId);
  const explorerUrl = descriptor?.blockExplorerUrl;
  if (!explorerUrl) return "";
  return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Re-exported from chain-family.ts so callers in this module can resolve a
 * descriptor without a circular import. (chain-family.ts does not import
 * from chains.ts.)
 */
import { getChainDescriptor as getChainDescriptorForHosts } from "./chain-family";

/**
 * Returns true for any supported chainId across all families (EVM + Stellar).
 */
export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/**
 * Returns true for EVM-supported chainIds only (legacy helper for code paths
 * that genuinely require a viem `Chain`, such as the EVM event listener).
 */
export function isEvmSupportedChainId(chainId: number): chainId is EvmSupportedChainId {
  return (EVM_SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}

/**
 * Resolves a viem `Chain` object from a numeric chainId.
 *
 * Throws for non-EVM chainIds — there is no viem `Chain` for Stellar.
 * Callers that need cross-family identity should use `getChainDescriptor`
 * from chain-family.ts instead.
 */
export function getChain(chainId: number): Chain {
  const chain = isEvmSupportedChainId(chainId)
    ? CHAIN_MAP[chainId]
    : undefined;
  if (!chain) {
    if (isSupportedChainId(chainId)) {
      throw new Error(
        `[getChain] chainId ${chainId} is supported but is not an EVM chain. ` +
          `Use getChainDescriptor() from chain-family.ts for cross-family identity.`,
      );
    }
    throw new Error(
      `[getChain] Unsupported chainId: ${chainId}. ` +
      `Supported: ${Object.keys(CHAIN_MAP).join(', ')} (EVM) + Stellar synthetic ids.`,
    );
  }
  return chain;
}
