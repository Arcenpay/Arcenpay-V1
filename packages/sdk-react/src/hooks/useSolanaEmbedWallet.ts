"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SolanaEmbedWalletState {
  address: string | null;
  isConnected: boolean;
  isLoading: boolean;
  ready: boolean;
  error: string | null;
}

/** A prepared Solana instruction as returned by the hosted activation endpoint. */
export interface SolanaPreparedInstruction {
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  /** base64-encoded instruction data. */
  data: string;
}

const STORAGE_KEY = "arcenpay:embed:solana-wallet";

type InjectedSolanaProvider = {
  publicKey?: { toBase58(): string } | null;
  isConnected?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?: () => Promise<void>;
  signAndSendTransaction?: (tx: unknown) => Promise<{ signature: string }>;
  signTransaction?: (tx: unknown) => Promise<{ serialize(): Uint8Array }>;
};

function getProvider(): InjectedSolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    phantom?: { solana?: InjectedSolanaProvider };
    solana?: InjectedSolanaProvider;
    solflare?: InjectedSolanaProvider;
  };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? null;
}

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
 * Lightweight injected Solana wallet hook for ArcenEmbed
 * (Phantom / Solflare — via `window.solana`, no heavy adapter dependency).
 *
 * `sendTransaction` builds a legacy `Transaction` from a backend-prepared
 * instruction, sets the connected wallet as fee payer, fetches a fresh
 * blockhash from the plan's RPC, and submits it through the wallet.
 */
export function useSolanaEmbedWallet() {
  const [state, setState] = useState<SolanaEmbedWalletState>({
    address: getPersistedAddress(),
    isConnected: Boolean(getPersistedAddress()),
    isLoading: false,
    ready: false,
    error: null,
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const provider = getProvider();
    if (!provider) {
      setState((s) => ({ ...s, ready: true }));
      return () => {
        mountedRef.current = false;
      };
    }
    let cancelled = false;
    void provider
      .connect({ onlyIfTrusted: true })
      .then((res) => {
        if (cancelled || !mountedRef.current) return;
        const address = res.publicKey.toBase58();
        setPersistedAddress(address);
        setState((s) => ({ ...s, address, isConnected: true, ready: true }));
      })
      .catch(() => {
        if (!cancelled && mountedRef.current) setState((s) => ({ ...s, ready: true }));
      });
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const provider = getProvider();
    if (!provider) {
      setState((s) => ({ ...s, error: "No Solana wallet detected" }));
      return;
    }
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const res = await provider.connect();
      const address = res.publicKey.toBase58();
      setPersistedAddress(address);
      if (mountedRef.current) {
        setState((s) => ({ ...s, address, isConnected: true, isLoading: false }));
      }
    } catch (err) {
      if (mountedRef.current) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : "Wallet connection failed",
        }));
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await getProvider()?.disconnect?.();
    } catch {
      // ignore
    }
    setPersistedAddress(null);
    if (mountedRef.current) {
      setState((s) => ({ ...s, address: null, isConnected: false }));
    }
  }, []);

  const sendTransaction = useCallback(
    async (
      programId: string,
      instruction: SolanaPreparedInstruction,
      rpcUrl: string,
    ): Promise<string> => {
      const provider = getProvider();
      if (!provider) throw new Error("No Solana wallet detected");
      const payer = state.address ?? provider.publicKey?.toBase58();
      if (!payer) throw new Error("Connect your Solana wallet first");

      const { Connection, PublicKey, Transaction, TransactionInstruction } = await import(
        "@solana/web3.js"
      );

      const ix = new TransactionInstruction({
        programId: new PublicKey(programId),
        keys: instruction.keys.map((k) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(instruction.data, "base64"),
      });

      const connection = new Connection(rpcUrl, "confirmed");
      const tx = new Transaction().add(ix);
      tx.feePayer = new PublicKey(payer);
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

      if (provider.signAndSendTransaction) {
        const { signature } = await provider.signAndSendTransaction(tx);
        return signature;
      }
      if (provider.signTransaction) {
        const signed = await provider.signTransaction(tx);
        const signature = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(signature, "confirmed");
        return signature;
      }
      throw new Error("Wallet does not support transaction signing");
    },
    [state.address],
  );

  return { ...state, connect, disconnect, sendTransaction };
}
