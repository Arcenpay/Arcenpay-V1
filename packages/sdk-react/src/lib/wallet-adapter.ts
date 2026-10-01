/**
 * Chain-Agnostic Wallet Adapter Interface
 *
 * Abstracts wallet connection, address resolution, and transaction signing
 * across chain families (EVM, Stellar, future: Solana, etc.).
 *
 * The embed consumes this interface; concrete adapters bind to specific
 * wallet SDKs (wagmi for EVM, Freighter for Stellar).
 */

export interface WalletAdapter {
  readonly family: string;
  readonly chainId: number;

  /** Human-readable wallet name (e.g. "MetaMask", "Freighter") */
  readonly name: string;

  /** True if the wallet extension/app is installed */
  readonly isInstalled: boolean;

  /** True if the user has connected and authorized */
  readonly isConnected: boolean;

  /** Connected address, or null */
  readonly address: string | null;

  /** Trigger connection flow */
  connect(): Promise<void>;

  /** Disconnect / clear session */
  disconnect(): Promise<void>;

  /**
   * Sign and submit a transaction.
   *
   * EVM: params are { to, data, value?, chainId }
   * Stellar: params are { contractId, method, args, networkPassphrase }
   *
   * Returns { txHash } on success.
   */
  sendTransaction(params: AdapterTxParams): Promise<{ txHash: string }>;
}

export type AdapterTxParams =
  | EvmTxParams
  | StellarTxParams
  | SolanaTxParams;

export interface EvmTxParams {
  family: "evm";
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  chainId: number;
}

export interface StellarTxParams {
  family: "stellar";
  contractId: string;
  method: string;
  args: Record<string, unknown>;
  networkPassphrase: string;
  rpcUrl: string;
}

/**
 * A prepared Solana instruction, assembled by the caller/backend and signed +
 * sent by the connected wallet (Phantom/Solflare/…).
 */
export interface SolanaTxParams {
  family: "solana";
  /** Base58 program id. */
  programId: string;
  /** Account metas in program order. */
  keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  /** Base64-encoded instruction data (Anchor discriminator + args). */
  data: string;
  /** RPC endpoint used to fetch the blockhash and confirm. */
  rpcUrl: string;
}

export interface AdapterFactory {
  createAdapter(chainId: number): WalletAdapter | null;
}
