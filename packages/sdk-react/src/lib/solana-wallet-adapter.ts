/**
 * Solana Wallet Adapter
 *
 * Wraps the injected Solana wallet provider (Phantom, Solflare, Backpack, …)
 * exposed on `window.solana` / `window.phantom.solana` / `window.solflare`.
 *
 * The backend hands the client a *prepared instruction* (program id, account
 * metas, base64 data); this adapter assembles a transaction, fetches the
 * blockhash, and asks the wallet to sign + send it.
 */

import { type WalletAdapter, type SolanaTxParams } from "./wallet-adapter";

interface InjectedSolanaProvider {
  isConnected?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{
    publicKey: { toBase58(): string };
  }>;
  disconnect(): Promise<void>;
  signAndSendTransaction(tx: unknown): Promise<{ signature: string }>;
}

function getInjectedProvider(): InjectedSolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    solana?: InjectedSolanaProvider;
    phantom?: { solana?: InjectedSolanaProvider };
    solflare?: InjectedSolanaProvider;
  };
  return w.phantom?.solana ?? w.solana ?? w.solflare ?? null;
}

export class SolanaWalletAdapter implements WalletAdapter {
  readonly family = "solana";
  readonly chainId: number;
  readonly name: string;
  isInstalled = false;
  isConnected = false;
  address: string | null = null;

  constructor(chainId: number) {
    this.chainId = chainId;
    const provider = getInjectedProvider();
    this.isInstalled = Boolean(provider);
    this.name = provider ? "Solana Wallet" : "Solana Wallet (not installed)";
  }

  async connect(): Promise<void> {
    const provider = getInjectedProvider();
    if (!provider) {
      throw new Error(
        "No Solana wallet detected. Install Phantom, Solflare or another Solana wallet.",
      );
    }
    const result = await provider.connect();
    const address =
      result?.publicKey?.toBase58?.() ?? provider.publicKey?.toBase58?.() ?? null;
    if (!address) throw new Error("Solana wallet connection cancelled");
    this.address = address;
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    const provider = getInjectedProvider();
    try {
      await provider?.disconnect();
    } catch {
      // Ignore provider disconnect errors.
    }
    this.address = null;
    this.isConnected = false;
  }

  async sendTransaction(params: SolanaTxParams): Promise<{ txHash: string }> {
    if (!this.address) throw new Error("Solana wallet not connected");
    const provider = getInjectedProvider();
    if (!provider) throw new Error("No Solana wallet detected");

    const { Connection, PublicKey, Transaction, TransactionInstruction } =
      await import("@solana/web3.js");

    const connection = new Connection(params.rpcUrl, "confirmed");
    const instruction = new TransactionInstruction({
      programId: new PublicKey(params.programId),
      keys: params.keys.map((k) => ({
        pubkey: new PublicKey(k.pubkey),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(params.data, "base64"),
    });

    const transaction = new Transaction().add(instruction);
    transaction.feePayer = new PublicKey(this.address);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;

    const { signature } = await provider.signAndSendTransaction(transaction);
    await connection.confirmTransaction(signature, "confirmed");
    return { txHash: signature };
  }
}
