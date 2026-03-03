// ============================================================
//  @meap/core — Chain Configurations
//  Supported blockchain network definitions
// ============================================================

import { type Chain, defineChain } from 'viem';

// --- Sepolia (Primary Dev Testnet) ---
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
    default: { http: ['https://sepolia.base.org'] },
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

// --- Supported Chains Map ---
export const SUPPORTED_CHAINS = {
  sepolia,
  baseSepolia,
  baseMainnet,
} as const;

export type SupportedChainId = 11155111 | 84532 | 8453;

// --- Well-Known Token Addresses ---
export const TOKENS = {
  // Sepolia (Primary Dev)
  11155111: {
    USDC: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const,
  },
  // Base Sepolia
  84532: {
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
  },
  // Base Mainnet
  8453: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  },
} as const;

// --- Default Chain ---
export const DEFAULT_CHAIN_ID: SupportedChainId = 11155111; // Sepolia for development

/**
 * Resolves a viem Chain object from a numeric chainId.
 * Throws if the chain is not supported.
 */
export function getChain(chainId: number): Chain {
  const chainMap: Record<number, Chain> = {
    11155111: sepolia,
    84532: baseSepolia,
    8453: baseMainnet,
  };
  const chain = chainMap[chainId];
  if (!chain) {
    throw new Error(
      `[getChain] Unsupported chainId: ${chainId}. ` +
      `Supported: ${Object.keys(chainMap).join(', ')}`
    );
  }
  return chain;
}
