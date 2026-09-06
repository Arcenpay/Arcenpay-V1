/**
 * Stellar Wallet Adapter — wraps @stellar/freighter-api
 */

import { type WalletAdapter, type StellarTxParams } from "./wallet-adapter";
import {
  contract as stellarContract,
  rpc,
  TransactionBuilder,
  Operation,
  xdr,
  BASE_FEE,
  Networks,
} from "@stellar/stellar-sdk";

let freighterApi: typeof import("@stellar/freighter-api") | null = null;

async function getFreighterApi() {
  if (freighterApi) return freighterApi;
  freighterApi = await import("@stellar/freighter-api");
  return freighterApi;
}

export class StellarWalletAdapter implements WalletAdapter {
  readonly family = "stellar";
  readonly chainId: number;
  readonly name = "Freighter";
  isInstalled = false;
  isConnected = false;
  address: string | null = null;
  private networkPassphrase: string;

  constructor(chainId: number, networkPassphrase?: string) {
    this.chainId = chainId;
    // Mainnet (9_000_000) uses the PUBLIC passphrase; all other Stellar ids
    // default to TESTNET unless an explicit passphrase is supplied.
    this.networkPassphrase =
      networkPassphrase ??
      (chainId === 9_000_000 ? Networks.PUBLIC : Networks.TESTNET);
    this.detectInstallation();
  }

  private   async detectInstallation() {
    try {
      const api = await getFreighterApi();
      const result = await api.isConnected();
      this.isInstalled = typeof result === "boolean" ? result : Boolean(result.isConnected);
    } catch {
      this.isInstalled = false;
    }
  }

  async connect(): Promise<void> {
    const api = await getFreighterApi();
    const result = await api.requestAccess();
    const address = typeof result === "string" ? result : result.address;
    if (!address) throw new Error("Freighter connection cancelled");
    this.address = address;
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    this.address = null;
    this.isConnected = false;
  }

  async sendTransaction(params: StellarTxParams): Promise<{ txHash: string }> {
    if (!this.address) throw new Error("Freighter not connected");

    const client = (await stellarContract.Client.from({
      contractId: params.contractId,
      networkPassphrase: params.networkPassphrase,
      rpcUrl: params.rpcUrl,
      publicKey: this.address,
      signTransaction: async (xdrStr) => {
        const api = await getFreighterApi();
        const result = await api.signTransaction(xdrStr, {
          networkPassphrase: params.networkPassphrase,
          address: this.address!,
        });
        return { signedTxXdr: result.signedTxXdr };
      },
    })) as any;

    const tx = await (client as any)[params.method](params.args);
    const sent = await tx.signAndSend();
    const hash = sent.sendTransactionResponse?.hash ?? "";
    return { txHash: hash };
  }
}
