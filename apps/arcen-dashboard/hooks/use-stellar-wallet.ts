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

let kitReady = false;

export function useStellarWallet() {
  const [state, setState] = useState<StellarWalletState>({
    address: null,
    isConnected: false,
    isLoading: false,
    ready: kitReady,
    error: null,
  });

  const mountedRef = useRef(true);

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

  const disconnect = useCallback(async () => {
    try { await StellarWalletsKit.disconnect(); } catch { /* ignore */ }
    if (mountedRef.current) setState((s) => ({ ...s, address: null, isConnected: false }));
  }, []);

  return { ...state, connect, signMessage, disconnect, chainId: 9000001 };
}
