"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface StellarEmbedWalletState {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  ready: boolean;
  error: string | null;
}

const STORAGE_KEY = "arcenpay:embed:stellar-wallet";

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

/**
 * Lightweight Freighter-only Stellar wallet hook for ArcenEmbed.
 * Uses @stellar/freighter-api (no heavy wallet-kit dependency).
 *
 * @param network The Stellar network the embed is operating on. Derived from
 *   the plan/runtime chainId by the caller (mainnet → PUBLIC, testnet →
 *   TESTNET). Threaded into every signTransaction call so a mainnet plan is
 *   never signed with a testnet passphrase.
 */
export function useStellarEmbedWallet(
  network: "PUBLIC" | "TESTNET" = "TESTNET",
) {
  const [state, setState] = useState<StellarEmbedWalletState>({
    address: getPersistedAddress(),
    isConnected: Boolean(getPersistedAddress()),
    isLoading: false,
    ready: false,
    error: null,
  });

  const mountedRef = useRef(true);
  const networkRef = useRef(network);
  networkRef.current = network;
  // Stellar network passphrases (mirrors @arcenpay/internal-core chain-family).
  const passphraseForNetwork: Record<"PUBLIC" | "TESTNET", string> = {
    PUBLIC: "Public Global Stellar Network ; September 2015",
    TESTNET: "Test SDF Network ; September 2015",
  };

  // Rehydrate from localStorage after client mount
  useEffect(() => {
    const stored = getPersistedAddress();
    if (stored) {
      setState((s) => ({ ...s, address: stored, isConnected: true }));
    }
  }, []);

  // Detect if Freighter is installed and get the real current address
  useEffect(() => {
    mountedRef.current = true;

    async function checkFreighter() {
      try {
        const freighter = await import("@stellar/freighter-api");
        const ok = await freighter.isConnected();
        if (mountedRef.current) {
          setState((s) => ({ ...s, ready: true }));
          if (ok) {
            // Always ask Freighter for the live address (handles wallet switches)
            const live = await freighter.getAddress();
            if (live.address) {
              setPersistedAddress(live.address);
              setState((s) => ({
                ...s,
                address: live.address,
                isConnected: true,
              }));
            } else {
              const stored = getPersistedAddress();
              if (stored) {
                setState((s) => ({ ...s, address: stored, isConnected: true }));
              }
            }
          }
        }
      } catch {
        if (mountedRef.current) setState((s) => ({ ...s, ready: true }));
      }
    }

    checkFreighter();
    return () => { mountedRef.current = false; };
  }, []);

  const connect = useCallback(async () => {
    try {
      setState((s) => ({ ...s, isLoading: true, error: null }));
      const freighter = await import("@stellar/freighter-api");

      // Request address from Freighter
      const { address } = await freighter.requestAccess();
      if (!address) throw new Error("No address returned from Freighter");

      if (mountedRef.current) {
        setPersistedAddress(address);
        setState((s) => ({
          ...s,
          address,
          isConnected: true,
          isLoading: false,
        }));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("denied") || msg.includes("rejected") || msg.includes("cancelled")) {
        setState((s) => ({ ...s, isLoading: false }));
      } else {
        setState((s) => ({ ...s, isLoading: false, error: msg || "Connection failed" }));
      }
    }
  }, []);

  const signTransaction = useCallback(async (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) => {
    const freighter = await import("@stellar/freighter-api");
    const result = await freighter.signTransaction(xdr, {
      // Prefer the caller-provided passphrase; fall back to the network this
      // hook was initialized with so the active chain always signs correctly.
      networkPassphrase:
        opts?.networkPassphrase ??
        passphraseForNetwork[networkRef.current],
      address: opts?.address,
    });
    if (!result.signedTxXdr) throw new Error("Signing failed or was cancelled");
    return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
  }, []);

  const disconnect = useCallback(async () => {
    setPersistedAddress(null);
    if (mountedRef.current) setState((s) => ({ ...s, address: null, isConnected: false }));
  }, []);

  return { ...state, connect, signTransaction, disconnect };
}
