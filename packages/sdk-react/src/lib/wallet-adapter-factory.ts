/**
 * Wallet Adapter Factory — picks the right adapter for a given chainId.
 */

import { isEvmChain, getStellarNetworkPassphrase } from "../internal/core";
import { EvmWalletAdapter } from "./evm-wallet-adapter";
import { StellarWalletAdapter } from "./stellar-wallet-adapter";
import type { WalletAdapter } from "./wallet-adapter";

export function createWalletAdapter(chainId: number): WalletAdapter | null {
  if (isEvmChain(chainId)) {
    return new EvmWalletAdapter(chainId);
  }
  // Stellar (synthetic IDs 9_000_000+)
  const passphrase = getStellarNetworkPassphrase(chainId);
  return new StellarWalletAdapter(chainId, passphrase);
}

export { EvmWalletAdapter, StellarWalletAdapter };
export type { WalletAdapter };
