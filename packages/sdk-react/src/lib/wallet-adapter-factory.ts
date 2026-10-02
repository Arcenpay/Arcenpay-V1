/**
 * Wallet Adapter Factory — picks the right adapter for a given chainId.
 */

import {
  isEvmChain,
  isSolanaChain,
  getStellarNetworkPassphrase,
} from "../internal/core";
import { EvmWalletAdapter } from "./evm-wallet-adapter";
import { StellarWalletAdapter } from "./stellar-wallet-adapter";
import { SolanaWalletAdapter } from "./solana-wallet-adapter";
import type { WalletAdapter } from "./wallet-adapter";

export function createWalletAdapter(chainId: number): WalletAdapter | null {
  if (isEvmChain(chainId)) {
    return new EvmWalletAdapter(chainId);
  }
  // Solana (synthetic IDs 9_100_000+): injected wallet (Phantom/Solflare/…).
  if (isSolanaChain(chainId)) {
    return new SolanaWalletAdapter(chainId);
  }
  // Stellar (synthetic IDs 9_000_000+)
  const passphrase = getStellarNetworkPassphrase(chainId);
  return new StellarWalletAdapter(chainId, passphrase);
}

export { EvmWalletAdapter, StellarWalletAdapter, SolanaWalletAdapter };
export type { WalletAdapter };
