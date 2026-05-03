"use client";

import { useCallback } from "react";
import { useAppKit } from "@reown/appkit/react";
import { toast } from "sonner";
import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { BASE_SEPOLIA_CHAIN_ID, getChainLabel } from "@/lib/default-chain";

export const REQUIRED_WALLET_CHAIN_ID = BASE_SEPOLIA_CHAIN_ID;
export const REQUIRED_WALLET_CHAIN_LABEL = getChainLabel(REQUIRED_WALLET_CHAIN_ID);

export function normalizeWalletAddress(address?: string | null): string | null {
  return address?.trim().toLowerCase() ?? null;
}

export function shortWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useDashboardWallet(linkedWallet?: string | null) {
  const { open } = useAppKit();
  const { address, isConnected } = useAccount();
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
  const isOnRequiredNetwork = chainId === REQUIRED_WALLET_CHAIN_ID;
  const isWrongNetwork = hasConnectedWallet && !isOnRequiredNetwork;
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
      toast.error(message);
    }
  }, [disconnectAsync]);

  const reconnectWallet = useCallback(async () => {
    try {
      if (hasConnectedWallet) {
        await disconnectAsync();
      }
      await open({ view: "Connect" });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reconnect wallet.";
      toast.error(message);
    }
  }, [disconnectAsync, hasConnectedWallet, open]);

  const switchToRequiredNetwork = useCallback(async () => {
    if (!hasConnectedWallet) {
      await open({ view: "Connect" });
      return;
    }

    try {
      await switchChainAsync({ chainId: REQUIRED_WALLET_CHAIN_ID });
    } catch {
      await open({ view: "Networks" });
    }
  }, [hasConnectedWallet, open, switchChainAsync]);

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
    isOnRequiredNetwork,
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
    switchToRequiredNetwork,
  };
}
