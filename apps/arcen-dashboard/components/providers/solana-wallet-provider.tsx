"use client";

import { useMemo, type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { CoinbaseWalletAdapter } from "@solana/wallet-adapter-coinbase";
import { getSolanaRpcUrl } from "@arcenpay/internal-core";

// The picker modal's styles (wallet list, "Other wallets", install links).
import "@solana/wallet-adapter-react-ui/styles.css";

const MAINNET_CHAIN_ID = 9_100_000;

/**
 * Solana wallet stack — the Solana counterpart to Reown/AppKit for EVM.
 *
 * `WalletProvider` manages the connected wallet; `WalletModalProvider`
 * provides the standard wallet-selection modal (`useWalletModal().setVisible`),
 * which is what "Connect wallet" opens — a real picker listing Phantom,
 * Solflare, Backpack, Coinbase, plus install links — instead of calling a
 * single injected provider directly.
 */
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(
    () => getSolanaRpcUrl(MAINNET_CHAIN_ID) || "https://api.mainnet-beta.solana.com",
    [],
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
