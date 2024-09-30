"use client";

import { useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection } from "@solana/web3.js";
import { encodeBase58 } from "@/lib/solana";

export interface SolanaWalletState {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

interface InjectedSolanaProvider {
  publicKey?: { toBase58(): string } | null;
}

function getInjectedProvider(): InjectedSolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    solana?: InjectedSolanaProvider;
    phantom?: { solana?: InjectedSolanaProvider };
    solflare?: InjectedSolanaProvider;
  };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? null;
}

/** Whether an injected Solana wallet exists (pre-connect messaging only). */
export function isSolanaWalletInstalled(): boolean {
  return getInjectedProvider() !== null;
}

/**
 * Dashboard Solana wallet — the Solana counterpart to wagmi/Reown for EVM.
 *
 * Backed by the standard `@solana/wallet-adapter` stack. `connect()` opens the
 * wallet-selection **modal** (Phantom / Solflare / Backpack / Coinbase + install
 * links) rather than calling a single injected provider directly — that modal is
 * the Solana equivalent of the WalletConnect picker.
 *
 * The rest of the shape mirrors the previous implementation, so existing
 * callers (`signMessage`, `sendTransaction`) are unchanged.
 */
export function useSolanaWallet(_chainId: number = 9_100_001) {
  const {
    publicKey,
    connected,
    connecting,
    disconnect: disconnectWallet,
    signMessage: adapterSignMessage,
    sendTransaction: adapterSendTransaction,
  } = useWallet();
  const { setVisible } = useWalletModal();

  const address = publicKey ? publicKey.toBase58() : null;

  /** Open the wallet-selection modal (the WalletConnect-style picker). */
  const connect = useCallback(async () => {
    setVisible(true);
  }, [setVisible]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectWallet();
    } catch {
      // best-effort
    }
  }, [disconnectWallet]);

  const signMessage = useCallback(
    async (message: string): Promise<{ signedMessage: string; signerAddress: string }> => {
      if (!adapterSignMessage) {
        throw new Error("This wallet does not support message signing.");
      }
      const signature = await adapterSignMessage(new TextEncoder().encode(message));
      // The backend verifies Solana signatures as base58.
      return { signedMessage: encodeBase58(signature), signerAddress: address ?? "" };
    },
    [adapterSignMessage, address],
  );

  const sendTransaction = useCallback(
    async (transaction: unknown, rpcUrl: string): Promise<string> => {
      const connection = new Connection(rpcUrl, "confirmed");
      return adapterSendTransaction(
        transaction as Parameters<typeof adapterSendTransaction>[0],
        connection,
      );
    },
    [adapterSendTransaction],
  );

  return {
    address,
    isConnected: connected,
    isLoading: connecting,
    error: null,
    connect,
    disconnect,
    signMessage,
    sendTransaction,
  };
}
