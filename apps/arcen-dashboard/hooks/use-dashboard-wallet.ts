"use client";

import { useCallback } from "react";
import { useAppKit, useAppKitAccount } from "@reown/appkit/react";
import { toast } from "sonner";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import {
  DEFAULT_CHAIN_ID,
  isSupportedDashboardChainId,
  isSupportedWalletAuthChainId,
  getChainLabel,
  SUPPORTED_DASHBOARD_CHAIN_LABEL,
} from "@/lib/default-chain";

export const DEFAULT_WALLET_CHAIN_ID = DEFAULT_CHAIN_ID;
export const DEFAULT_WALLET_CHAIN_LABEL = getChainLabel(DEFAULT_WALLET_CHAIN_ID);
export const SUPPORTED_WALLET_CHAIN_LABEL = SUPPORTED_DASHBOARD_CHAIN_LABEL;

// backward-compat aliases
export const REQUIRED_WALLET_CHAIN_ID = DEFAULT_WALLET_CHAIN_ID;
export const REQUIRED_WALLET_CHAIN_LABEL = DEFAULT_WALLET_CHAIN_LABEL;

export function normalizeWalletAddress(address?: string | null): string | null {
  return address?.trim().toLowerCase() ?? null;
}

export function shortWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useDashboardWallet(linkedWallet?: string | null) {
  const { open } = useAppKit();
  const wagmiAccount = useAccount();
  const appKitAccount = useAppKitAccount();

  const isConnected =
    wagmiAccount.isConnected ||
    Boolean(appKitAccount.isConnected && appKitAccount.address);
  const address = (wagmiAccount.address || appKitAccount.address) as
    | `0x${string}`
    | undefined;
  const chainId = useChainId();
  const { disconnectAsync, isPending: isDisconnecting } = useDisconnect();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const normalizedLinkedWallet = normalizeWalletAddress(linkedWallet);
  const normalizedConnectedWallet = normalizeWalletAddress(address);
  const hasConnectedWallet = Boolean(isConnected && normalizedConnectedWallet);
  const hasLinkedWallet = Boolean(normalizedLinkedWallet);
  const isLinkedWalletConnected =
    Boolean(normalizedLinkedWallet) &&
    Boolean(normalizedConnectedWallet) &&
    normalizedLinkedWallet === normalizedConnectedWallet;
  const isWrongWalletConnected =
    hasLinkedWallet && hasConnectedWallet && !isLinkedWalletConnected;
  const isOnSupportedNetwork = isSupportedWalletAuthChainId(chainId);
  const isWrongNetwork = hasConnectedWallet && !isOnSupportedNetwork;
  const connectedWalletLabel = address ? shortWalletAddress(address) : null;
  const linkedWalletLabel = linkedWallet ? shortWalletAddress(linkedWallet) : null;
  const currentNetworkLabel = chainId ? getChainLabel(chainId) : null;

  const openConnectModal = useCallback(async () => {
    await open({ view: "Connect" });
  }, [open]);

  const openAccountModal = useCallback(async () => {
    await open({ view: "Account" });
  }, [open]);

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not disconnect wallet.";
      if (!message.includes("before enable") && !message.includes("connect()")) {
        toast.error(message);
      }
    }
  }, [disconnectAsync]);

  const reconnectWallet = useCallback(async () => {
    try {
      if (hasConnectedWallet) {
        try {
          await disconnectAsync();
        } catch (err) {
          console.warn("[useDashboardWallet] Disconnect before reconnect ignored:", err);
        }
      }
      await open({ view: "Connect" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reconnect wallet.";
      if (!message.includes("before enable") && !message.includes("connect()")) {
        toast.error(message);
      }
    }
  }, [disconnectAsync, hasConnectedWallet, open]);

  const switchToSupportedNetwork = useCallback(async (targetChainId?: number) => {
    if (!hasConnectedWallet) {
      await open({ view: "Connect" });
      return;
    }

    const target = targetChainId ?? (isSupportedDashboardChainId(chainId) ? chainId : DEFAULT_WALLET_CHAIN_ID);

    try {
      await switchChainAsync({ chainId: target });
    } catch {
      await open({ view: "Networks" });
    }
  }, [hasConnectedWallet, chainId, open, switchChainAsync]);

  return {
    address,
    chainId,
    connectedWalletLabel,
    currentNetworkLabel,
    hasConnectedWallet,
    hasLinkedWallet,
    isConnected,
    isDisconnecting,
    isLinkedWalletConnected,
    isOnSupportedNetwork,
    isSwitchingChain,
    isWrongNetwork,
    isWrongWalletConnected,
    linkedWalletLabel,
    normalizedConnectedWallet,
    normalizedLinkedWallet,
    openAccountModal,
    openConnectModal,
    reconnectWallet,
    disconnectWallet,
    switchToSupportedNetwork,
    // backward-compat aliases
    isOnRequiredNetwork: isOnSupportedNetwork,
    switchToRequiredNetwork: switchToSupportedNetwork,
  };
}
