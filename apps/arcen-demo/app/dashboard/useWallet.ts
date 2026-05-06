"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface EthereumProvider {
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
  request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  selectedAddress?: string | null;
}

function getEthereum(): EthereumProvider | undefined {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const eth = getEthereum();
    setAvailable(!!eth?.request);
    if (!eth) return;

    if (eth.selectedAddress) setAddress(eth.selectedAddress);

    const onChange = (...args: unknown[]) => {
      setAddress((args[0] as string[])?.at(0) ?? null);
    };
    eth.on?.("accountsChanged", onChange);

    return () => {
      eth.removeListener?.("accountsChanged", onChange);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = getEthereum();
    if (!eth?.request) return;
    setConnecting(true);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0] ?? null);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  return {
    address,
    isConnected: !!address,
    connecting,
    available,
    connect,
    disconnect,
    shortAddr: address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null,
  };
}
