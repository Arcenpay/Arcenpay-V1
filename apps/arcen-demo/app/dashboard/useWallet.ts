"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";

export function useWallet() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { connectAsync, isPending: connecting } = useConnect();

  return {
    address: address ?? null,
    isConnected,
    connecting,
    isMobile: false,
    available: true,
    connect: () => connectAsync({ connector: injected() }),
    connectMetaMask: () => connectAsync({ connector: injected() }),
    connectCoinbase: () => connectAsync({ connector: injected() }),
    disconnect: () => disconnect(),
    shortAddr: address
      ? `${address.slice(0, 6)}\u2026${address.slice(-4)}`
      : null,
  };
}
