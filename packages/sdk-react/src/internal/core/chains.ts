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
    default: { http: ['https://rpc.testnet.arc.network'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://testnet.arcscan.app' },
  },
  testnet: true,
});

// --- Supported Chains Map ---
export const SUPPORTED_CHAINS = {
  sepolia,
  baseSepolia,
  baseMainnet,
  arcTestnet,
} as const;

export type SupportedChainId = 11155111 | 84532 | 8453 | 5042002;

// ─── Token Registry ──────────────────────────────────────────────────────────

/**
 * Describes a stablecoin / ERC-20 token on a given chain.
 */
export interface TokenInfo {
  readonly address: `0x${string}`;
  readonly decimals: number;
}

/**
 * Per-chain registry of well-known tokens.
 *
 * To add a new chain or token, extend this object:
 *   <chainId>: { <SYMBOL>: { address: '0x…', decimals: 6 } }
 */
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
  // Arc Testnet — USDC is the native gas token (18 decimals).
  // USDC ERC-20 precompile sits at 0x3600... with 6 decimals for compatibility.
  5042002: {
    USDC: { address: '0x3600000000000000000000000000000000000000' as const, decimals: 6 },
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
): `0x${string}` | undefined {
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

// ─── Chain Helpers ──────────────────────────────────────────────────────────

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: baseMainnet,
  5042002: arcTestnet,
};

// --- Default Chain ---
export const DEFAULT_CHAIN_ID: SupportedChainId = 5042002; // Arc Testnet is the current default

/**
 * Returns the block explorer transaction URL for a given chainId and tx hash.
 * Falls back to an empty string if the chainId is unknown.
 */
export function getBlockExplorerUrl(chainId: number, txHash: string): string {
  const chain = CHAIN_MAP[chainId];
  if (!chain) return '';
  const explorerUrl = chain.blockExplorers?.default?.url;
  if (!explorerUrl) return '';
  return `${explorerUrl}/tx/${txHash}`;
}

/**
 * Resolves a viem Chain object from a numeric chainId.
 * Throws if the chain is not supported.
 */
export function getChain(chainId: number): Chain {
  const chain = CHAIN_MAP[chainId];
  if (!chain) {
    throw new Error(
      `[getChain] Unsupported chainId: ${chainId}. ` +
      `Supported: ${Object.keys(CHAIN_MAP).join(', ')}`
    );
  }
  return chain;
}
