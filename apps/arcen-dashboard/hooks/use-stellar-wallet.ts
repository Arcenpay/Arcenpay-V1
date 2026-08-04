"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StellarWalletsKit, Networks } from "@creit-tech/stellar-wallets-kit";
import { FreighterModule } from "@creit-tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit-tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit-tech/stellar-wallets-kit/modules/albedo";
import { LobstrModule } from "@creit-tech/stellar-wallets-kit/modules/lobstr";

export interface StellarWalletState {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  ready: boolean;
  error: string | null;
}

const STORAGE_KEY = "arcenpay:stellar-wallet";

let kitReady = false;

function getPersistedAddress(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setPersistedAddress(address: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (address) localStorage.setItem(STORAGE_KEY, address);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function useStellarWallet() {
  const [state, setState] = useState<StellarWalletState>({
    address: getPersistedAddress(),
    isConnected: Boolean(getPersistedAddress()),
    isLoading: false,
    ready: kitReady,
    error: null,
  });

  const mountedRef = useRef(true);

  // Rehydrate from localStorage after client mount (SSR initializes with null)
  useEffect(() => {
    const stored = getPersistedAddress();
    if (stored) {
      setState((s) => ({
        ...s,
        address: stored,
        isConnected: true,
      }));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (kitReady) {
      setState((s) => ({ ...s, ready: true }));
      return;
    }

    try {
      StellarWalletsKit.init({
        modules: [
          new FreighterModule(),
          new xBullModule(),
          new AlbedoModule(),
          new LobstrModule(),
        ],
        network: Networks.TESTNET,
        authModal: {
          showInstallLabel: true,
          hideUnsupportedWallets: false,
        },
      });

      StellarWalletsKit.refreshSupportedWallets()
        .then(() => {
          kitReady = true;
          if (mountedRef.current) setState((s) => ({ ...s, ready: true }));
        })
        .catch(() => {
          kitReady = true;
          if (mountedRef.current) setState((s) => ({ ...s, ready: true }));
        });
    } catch {
      kitReady = true;
      setState((s) => ({ ...s, ready: true }));
    }

    return () => { mountedRef.current = false; };
  }, []);

  const connect = useCallback(async () => {
    try {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      const result = await StellarWalletsKit.authModal();
      if (mountedRef.current) {
        if (result.address) {
          setPersistedAddress(result.address);
          setState((s) => ({
            ...s,
            address: result.address,
            isConnected: true,
            isLoading: false,
          }));
        } else {
          setState((s) => ({ ...s, isLoading: false, error: "No address returned" }));
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("closed") || msg.includes("dismissed") || msg.includes("cancelled")) {
        setState((s) => ({ ...s, isLoading: false }));
      } else {
        setState((s) => ({ ...s, isLoading: false, error: msg || "Connection failed" }));
      }
    }
  }, []);

  const signMessage = useCallback(async (message: string): Promise<{ signedMessage: string; signerAddress: string }> => {
    const result = await StellarWalletsKit.signMessage(message);
    if (!result.signedMessage) throw new Error("Signing failed or was cancelled");
    return { signedMessage: result.signedMessage ?? "", signerAddress: state.address ?? "" };
  }, [state.address]);

  const signTransaction = useCallback(async (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string }
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> => {
    const result = await StellarWalletsKit.signTransaction(xdr, opts);
    if (!result.signedTxXdr) throw new Error("Transaction signing failed or was cancelled");
    return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
  }, []);

  const disconnect = useCallback(async () => {
    try { await StellarWalletsKit.disconnect(); } catch { /* ignore */ }
    setPersistedAddress(null);
    if (mountedRef.current) setState((s) => ({ ...s, address: null, isConnected: false }));
  }, []);

  return { ...state, connect, signMessage, signTransaction, disconnect, chainId: 9000001 };
}
