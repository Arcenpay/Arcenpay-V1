"use client";

import { useCallback, useMemo } from "react";
import { isStellarChainId, isSolanaChainId } from "@arcenpay/internal-core";
import { getChainLabel } from "@/lib/default-chain";
import { useDashboardWallet } from "./use-dashboard-wallet";
import { useStellarWallet } from "./use-stellar-wallet";
import { useSolanaWallet } from "./use-solana-wallet";

export interface UnifiedWalletState {
  // Identity
  storedWallet: string | null;
  connectedAddress: string | null;
  connectedWalletLabel: string | null;
  linkedWalletLabel: string | null;
  currentNetworkLabel: string | null;

  // Status
  hasConnectedWallet: boolean;
  hasLinkedWallet: boolean;
  isLinkedWalletConnected: boolean;
  isWrongWalletConnected: boolean;
  isOnConfiguredNetwork: boolean;
  isWrongNetwork: boolean;
  isLoading: boolean;
  isSwitchingChain: boolean;
  isDisconnecting: boolean;

  // Actions
  openConnectModal: () => Promise<void>;
  openAccountModal: () => Promise<void>;
  reconnectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToRequiredNetwork: (targetChainId?: number) => Promise<void>;
}

function shortStellarAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function shortEvmAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function useUnifiedDashboardWallet(
  configuredChainId: number | null | undefined,
  evmStoredWallet: string | null,
  stellarStoredWallet: string | null,
  solanaStoredWallet: string | null = null,
): UnifiedWalletState {
  const isStellar = Boolean(configuredChainId && isStellarChainId(configuredChainId));
  const isSolana = Boolean(configuredChainId && isSolanaChainId(configuredChainId));

  // EVM wallet state (always active in background — wagmi is global)
  const evm = useDashboardWallet(evmStoredWallet);

  // Stellar wallet state — pass the configured chain so the wallet kit signs
  // with the matching network passphrase (testnet vs mainnet).
  const stellar = useStellarWallet(configuredChainId ?? undefined);

  // Solana wallet state — injected provider (Phantom/Solflare/…).
  const solana = useSolanaWallet(configuredChainId ?? undefined);

  return useMemo(() => {
    if (isSolana) {
      const stored = solanaStoredWallet ?? null;
      const connected = solana.address ?? null;
      const hasConnected = Boolean(solana.isConnected && connected);
      const hasLinked = Boolean(stored);
      const isLinkedConnected =
        Boolean(stored) && Boolean(connected) && stored === connected;
      const isWrongConnected = hasLinked && hasConnected && !isLinkedConnected;

      return {
        storedWallet: stored,
        connectedAddress: connected,
        connectedWalletLabel: connected ? shortStellarAddress(connected) : null,
        linkedWalletLabel: stored ? shortStellarAddress(stored) : null,
        currentNetworkLabel: getChainLabel(configuredChainId),

        hasConnectedWallet: hasConnected,
        hasLinkedWallet: hasLinked,
        isLinkedWalletConnected: isLinkedConnected,
        isWrongWalletConnected: isWrongConnected,
        isOnConfiguredNetwork: hasConnected, // Solana wallets manage their own cluster
        isWrongNetwork: false,
        isLoading: solana.isLoading,
        isSwitchingChain: false,
        isDisconnecting: false,

        openConnectModal: async () => {
          await solana.connect();
        },
        openAccountModal: async () => {
          await solana.connect();
        },
        reconnectWallet: async () => {
          await solana.disconnect();
          await solana.connect();
        },
        disconnectWallet: async () => {
          await solana.disconnect();
        },
        switchToRequiredNetwork: async () => {
          // No-op: Solana wallets manage their cluster internally
        },
      };
    }

    if (isStellar) {
      const stored = stellarStoredWallet ?? null;
      const connected = stellar.address ?? null;
      const hasConnected = Boolean(stellar.isConnected && connected);
      const hasLinked = Boolean(stored);
      const isLinkedConnected =
        Boolean(stored) && Boolean(connected) && stored === connected;
      const isWrongConnected =
        hasLinked && hasConnected && !isLinkedConnected;

      return {
        storedWallet: stored,
        connectedAddress: connected,
        connectedWalletLabel: connected ? shortStellarAddress(connected) : null,
        linkedWalletLabel: stored ? shortStellarAddress(stored) : null,
        currentNetworkLabel: getChainLabel(configuredChainId),

        hasConnectedWallet: hasConnected,
        hasLinkedWallet: hasLinked,
        isLinkedWalletConnected: isLinkedConnected,
        isWrongWalletConnected: isWrongConnected,
        isOnConfiguredNetwork: hasConnected, // Stellar wallets manage their own network
        isWrongNetwork: false,
        isLoading: stellar.isLoading,
        isSwitchingChain: false,
        isDisconnecting: false,

        openConnectModal: async () => {
          await stellar.connect();
        },
        openAccountModal: async () => {
          // Stellar wallets have no "account modal" — open connect again
          await stellar.connect();
        },
        reconnectWallet: async () => {
          await stellar.disconnect();
          await stellar.connect();
        },
        disconnectWallet: async () => {
          await stellar.disconnect();
        },
        switchToRequiredNetwork: async () => {
          // No-op: Stellar wallets manage network internally
        },
      };
    }

    // EVM path — pass through useDashboardWallet directly
    return {
      storedWallet: evmStoredWallet,
      connectedAddress: evm.address ?? null,
      connectedWalletLabel: evm.connectedWalletLabel,
      linkedWalletLabel: evm.linkedWalletLabel,
      currentNetworkLabel: evm.currentNetworkLabel,

      hasConnectedWallet: evm.hasConnectedWallet,
      hasLinkedWallet: evm.hasLinkedWallet,
      isLinkedWalletConnected: evm.isLinkedWalletConnected,
      isWrongWalletConnected: evm.isWrongWalletConnected,
      isOnConfiguredNetwork: Boolean(configuredChainId && evm.isConnected && evm.chainId === configuredChainId),
      isWrongNetwork: evm.isWrongNetwork,
      isLoading: false,
      isSwitchingChain: evm.isSwitchingChain,
      isDisconnecting: evm.isDisconnecting,

      openConnectModal: evm.openConnectModal,
      openAccountModal: evm.openAccountModal,
      reconnectWallet: evm.reconnectWallet,
      disconnectWallet: evm.disconnectWallet,
      switchToRequiredNetwork: async () => {
        if (configuredChainId) {
          await evm.switchToSupportedNetwork(configuredChainId);
        } else {
          await evm.switchToSupportedNetwork();
        }
      },
    };
  }, [
    isStellar,
    isSolana,
    configuredChainId,
    evmStoredWallet,
    stellarStoredWallet,
    solanaStoredWallet,
    stellar,
    solana,
    evm,
  ]);
}
