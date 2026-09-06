/**
 * EVM Wallet Adapter — wraps wagmi / window.ethereum
 */

import { type WalletAdapter, type EvmTxParams } from "./wallet-adapter";
import {
  type WalletClient,
  createWalletClient,
  custom,
} from "viem";
import { getChain } from "../internal/core";

let wagmiModule: any = null;

try {
  wagmiModule = require("wagmi");
} catch {
  // wagmi not installed
}

export class EvmWalletAdapter implements WalletAdapter {
  readonly family = "evm";
  readonly chainId: number;
  readonly name: string;
  isInstalled = false;
  isConnected = false;
  address: string | null = null;
  private walletClient: WalletClient | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(chainId: number) {
    this.chainId = chainId;
    this.name = this.detectWalletName();
    this.isInstalled = typeof window !== "undefined" && !!window.ethereum;
    this.syncFromWagmi();
  }

  private detectWalletName(): string {
    const provider = (window as any).ethereum;
    if (!provider) return "EVM Wallet";
    if (provider.isMetaMask) return "MetaMask";
    if (provider.isCoinbaseWallet) return "Coinbase Wallet";
    if (provider.isTrust) return "Trust Wallet";
    if (provider.isBraveWallet) return "Brave Wallet";
    if (provider.isRabby) return "Rabby";
    return "EVM Wallet";
  }

  private syncFromWagmi() {
    if (!wagmiModule) return;
    // Wagmi hooks can't be called directly outside React components.
    // External synchronization is handled via setWagmiState.
  }

  setWagmiState(state: { address?: string; isConnected?: boolean; walletClient?: WalletClient }) {
    this.address = state.address ?? null;
    this.isConnected = state.isConnected ?? false;
    this.walletClient = state.walletClient ?? null;
  }

  async connect(): Promise<void> {
    if (typeof window === "undefined" || !window.ethereum) {
      throw new Error("No EVM wallet detected. Install MetaMask or another wallet.");
    }
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    this.address = (accounts[0] as string) ?? null;
    this.isConnected = !!this.address;

    const chain = getChain(this.chainId);
    this.walletClient = createWalletClient({
      chain,
      transport: custom(window.ethereum),
    });
  }

  async disconnect(): Promise<void> {
    this.address = null;
    this.isConnected = false;
    this.walletClient = null;
  }

  async sendTransaction(params: EvmTxParams): Promise<{ txHash: string }> {
    if (!this.walletClient || !this.address) {
      throw new Error("Wallet not connected");
    }
    const txHash = await this.walletClient.sendTransaction({
      account: this.address as `0x${string}`,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
      chain: getChain(params.chainId),
    });
    return { txHash };
  }
}
