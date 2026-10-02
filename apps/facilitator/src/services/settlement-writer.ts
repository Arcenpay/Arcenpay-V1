// ============================================================
//  @arcenpay/node — Settlement Writer Service
//  Executes on-chain session settlements for validated x402 payments
// ============================================================

import {
  createWalletClient,
  isAddress,
  type Hex,
} from "viem";
import { createResilientFacilitatorClient, getFacilitatorRpcTransport } from "../rpc-client.js";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CHAIN_ID,
  SessionVaultABI,
  FeeCollectorABI,
  getContractAddresses,
  getChainFamily,
  getChain,
  getSolanaRpcUrl,
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
} from "@arcenpay/internal-core";
import { Keypair } from "@stellar/stellar-sdk";
import {
  Connection,
  Keypair as SolanaKeypair,
  PublicKey as SolanaPublicKey,
  Transaction as SolanaTransaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  encodeSettle,
  findConfigPda,
  findSessionPda,
  findSettlerPda,
  findNullifierPda,
  findVaultAuthorityPda,
  findAssociatedTokenAddress,
  createSolanaConnection,
  parseSolanaSecretKey,
  TOKEN_PROGRAM_ID,
} from "./solana-instruction-codec.js";
import { decodeSessionRecord } from "./solana-event-codec.js";
import { createHash } from "node:crypto";
import { SYSTEM_PROGRAM_ID } from "@arcenpay/internal-core/solana";

type SessionState = {
  agent: `0x${string}`;
  token: `0x${string}`;
  balance: bigint;
  totalFunded: bigint;
  totalSettled: bigint;
  active: boolean;
  createdAt: bigint;
};

export interface SettlementWriterConfig {
  rpcUrl: string;
  /** EVM hex private key, or Stellar S… secret on Stellar chains. */
  privateKey: string;
  chainId?: number;
  sessionVaultAddress?: string;
  feeCollectorAddress?: `0x${string}`;
  providerAddress?: string;
  waitForReceipt?: boolean;
  /** Stellar-only: Soroban RPC URL. Defaults from chain registry/env. */
  sorobanRpcUrl?: string;
  /** Stellar-only: network passphrase. Defaults from chain registry. */
  networkPassphrase?: string;
  /** Stellar-only: Horizon URL. Defaults from chain registry. */
  horizonUrl?: string;
}

export interface SettleForSignerInput {
  signer: string;
  amount: bigint;
  sessionIdHint: string;
  providerAddress?: string;
  /**
   * Solana-only: 32-byte settlement nullifier (e.g. the x402 payment nonce).
   * When omitted a time-based nullifier is derived. It is recorded on-chain so
   * the same nullifier cannot settle twice.
   */
  nullifier?: Uint8Array;
}

export interface SettlementWriteResult {
  transactionHash: string;
  settledAmount: bigint;
  sessionId: string;
  providerAddress: string;
}

function isBytes32(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeSession(raw: unknown): SessionState {
  const value = raw as
    | {
        agent?: string;
        token?: string;
        balance?: bigint;
        totalFunded?: bigint;
        totalSettled?: bigint;
        active?: boolean;
        createdAt?: bigint;
        [index: number]: unknown;
      }
    | undefined;

  const agent = (value?.agent ??
    value?.[0] ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const token = (value?.token ??
    value?.[1] ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const balance = BigInt(
    (value?.balance ?? value?.[2] ?? 0n) as bigint | number | string,
  );
  const totalFunded = BigInt(
    (value?.totalFunded ?? value?.[3] ?? 0n) as bigint | number | string,
  );
  const totalSettled = BigInt(
    (value?.totalSettled ?? value?.[4] ?? 0n) as bigint | number | string,
  );
  const active = Boolean(value?.active ?? value?.[5] ?? false);
  const createdAt = BigInt(
    (value?.createdAt ?? value?.[6] ?? 0n) as bigint | number | string,
  );

  return {
    agent,
    token,
    balance,
    totalFunded,
    totalSettled,
    active,
    createdAt,
  };
}

/**
 * SettlementWriterService
 *
 * Writes `SessionVault.settle(sessionId, amount, provider)` transactions
 * using a facilitator signer configured in runtime environment.
 */
export class SettlementWriterService {
  private readonly chainId: number;
  private readonly sessionVaultAddress: string;
  private readonly feeCollectorAddress: `0x${string}`;
  private readonly providerAddress: string;
  private readonly signerAddress: string;
  private readonly waitForReceipt: boolean;
  private readonly isStellar: boolean;
  private readonly isSolana: boolean;
  private readonly publicClient: any;
  private readonly walletClient: any;
  private stellarKeypair: any = null;
  private stellarRpcUrl: string = "";
  private stellarPassphrase: string = "";
  private solanaKeypair: SolanaKeypair | null = null;
  private solanaConnection: Connection | null = null;
  private solanaProgramId: string = "";

  constructor(config: SettlementWriterConfig) {
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this.isStellar = getChainFamily(this.chainId) === "stellar";
    this.isSolana = getChainFamily(this.chainId) === "solana";
    const contracts = getContractAddresses(this.chainId);

    this.sessionVaultAddress =
      config.sessionVaultAddress || contracts.sessionVault;
    this.feeCollectorAddress = (config.feeCollectorAddress ||
      contracts.feeCollector) as `0x${string}`;
    this.waitForReceipt = config.waitForReceipt ?? true;

    if (this.isStellar) {
      // Stellar: keypair from S… secret; submit via Soroban client.
      this.stellarKeypair = Keypair.fromSecret(config.privateKey);
      this.signerAddress = this.stellarKeypair.publicKey();
      this.providerAddress =
        config.providerAddress || this.signerAddress;
      this.stellarPassphrase =
        config.networkPassphrase ??
        getStellarNetworkPassphrase(this.chainId);
      this.stellarRpcUrl =
        config.sorobanRpcUrl ?? getStellarSorobanRpcUrl(this.chainId);
      this.publicClient = null;
      this.walletClient = null;

      if (!this.sessionVaultAddress) {
        throw new Error(
          "Invalid SessionVault address for SettlementWriterService",
        );
      }
      if (!this.providerAddress) {
        throw new Error("Invalid provider address for SettlementWriterService");
      }
      return;
    }

    if (this.isSolana) {
      // Solana settlement runs through the ArcenPay Anchor program's
      // session-vault `settle` instruction. The "sessionVault" contract slot
      // holds the Anchor program id (one program serves all roles).
      if (!this.sessionVaultAddress) {
        throw new Error(
          "Solana SessionVault program id is not configured for SettlementWriterService " +
            `(ARCENPAY_CONTRACT_${this.chainId}_sessionVault).`,
        );
      }

      const keypair = SolanaKeypair.fromSecretKey(
        parseSolanaSecretKey(config.privateKey),
      );
      this.solanaKeypair = keypair;
      this.signerAddress = keypair.publicKey.toBase58();
      this.providerAddress = config.providerAddress || this.signerAddress;

      const rpcUrl = config.rpcUrl || getSolanaRpcUrl(this.chainId);
      if (!rpcUrl) {
        throw new Error(
          "No Solana RPC URL configured for SettlementWriterService.",
        );
      }
      this.solanaConnection = createSolanaConnection(this.chainId);
      this.solanaProgramId = this.sessionVaultAddress;
      this.publicClient = null;
      this.walletClient = null;
      return;
    }

    const account = privateKeyToAccount(config.privateKey as `0x${string}`);
    this.signerAddress = account.address;
    this.providerAddress =
      (config.providerAddress || account.address) as `0x${string}`;

    if (!isAddress(this.sessionVaultAddress)) {
      throw new Error(
        "Invalid SessionVault address for SettlementWriterService",
      );
    }
    if (!isAddress(this.providerAddress)) {
      throw new Error("Invalid provider address for SettlementWriterService");
    }

    this.publicClient = createResilientFacilitatorClient(config.rpcUrl, this.chainId) as any;

    // Resolve the viem `Chain` from the canonical internal-core registry
    // (never a stale local map) so the signed transaction embeds the real
    // chainId instead of silently defaulting to the wrong network.
    const chain = getChain(this.chainId);
    this.walletClient = createWalletClient({
      account,
      chain,
      transport: getFacilitatorRpcTransport(config.rpcUrl, this.chainId),
    }) as any;
  }

  getSignerAddress(): string {
    return this.signerAddress;
  }

  getSessionVaultAddress(): string {
    return this.sessionVaultAddress;
  }

  private async getStellarClient() {
    const { contract: stellarContract } = await import("@stellar/stellar-sdk");
    return (stellarContract as any).Client.from({
      contractId: this.sessionVaultAddress,
      networkPassphrase: this.stellarPassphrase,
      rpcUrl: this.stellarRpcUrl,
      publicKey: this.signerAddress,
      signTransaction: async (xdr: string) => {
        const tx = await (stellarContract as any).TransactionBuilder.fromXDR(
          xdr,
          this.stellarPassphrase,
        );
        tx.sign(this.stellarKeypair);
        return { signedTxXdr: tx.toXDR() };
      },
    });
  }

  async isSignerAuthorized(
    address: string = this.signerAddress,
  ): Promise<boolean> {
    if (this.isSolana) {
      // A settler is authorized iff its `["settler", settler]` registry PDA
      // exists (created by the program's `authorize_settler`).
      //
      // Deliberately NOT wrapped in try/catch: a transient RPC failure (e.g. a
      // 429 from a public endpoint) must surface as "could not verify"
      // (the caller marks authorization unknown) rather than being misreported
      // as "this signer is not authorized".
      if (!this.solanaConnection) return false;
      const [record] = findSettlerPda(this.solanaProgramId, address);
      const info = await this.solanaConnection.getAccountInfo(record);
      return info !== null;
    }
    if (this.isStellar) {
      // Stellar vault exposes `is_settler` — no authorizedSettlers mapping.
      try {
        const client = await this.getStellarClient();
        const result = await client.is_settler({ address });
        return Boolean(result?.result);
      } catch {
        return false;
      }
    }
    if (!isAddress(address)) {
      return false;
    }
    const authorized = await this.publicClient.readContract({
      address: this.sessionVaultAddress,
      abi: SessionVaultABI,
      functionName: "authorizedSettlers",
      args: [address],
    });
    return Boolean(authorized);
  }

  private async getSession(sessionId: `0x${string}`): Promise<SessionState> {
    const rawSession = await this.publicClient.readContract({
      address: this.sessionVaultAddress,
      abi: SessionVaultABI,
      functionName: "getSession",
      args: [sessionId],
    });
    return normalizeSession(rawSession);
  }

  private async resolveSessionId(
    sessionIdHint: string,
    signer: `0x${string}`,
  ): Promise<`0x${string}`> {
    const trimmedHint = sessionIdHint.trim();
    if (isBytes32(trimmedHint)) {
      return trimmedHint;
    }

    const sessionIds = (await this.publicClient.readContract({
      address: this.sessionVaultAddress,
      abi: SessionVaultABI,
      functionName: "getAgentSessions",
      args: [signer],
    })) as Hex[];

    if (!sessionIds.length) {
      throw new Error("No billing session found for signer");
    }

    for (let idx = sessionIds.length - 1; idx >= 0; idx -= 1) {
      const candidate = sessionIds[idx] as `0x${string}`;
      const session = await this.getSession(candidate);
      if (session.active && session.balance > 0n) {
        return candidate;
      }
    }

    throw new Error("No active billing session found for signer");
  }

  /**
   * Solana settlement: build + send the ArcenPay Anchor program's `settle`
   * instruction, moving `amount` from the session vault to the provider.
   */
  private async settleSolana(
    input: SettleForSignerInput,
  ): Promise<SettlementWriteResult> {
    const connection = this.solanaConnection;
    const keypair = this.solanaKeypair;
    if (!connection || !keypair) {
      throw new Error("Solana settlement writer is not initialized");
    }
    if (input.amount <= 0n) {
      throw new Error("Settlement amount must be greater than zero");
    }

    const sessionIdHint = input.sessionIdHint.trim();
    if (!/^\d+$/.test(sessionIdHint)) {
      throw new Error("Solana settlement requires a numeric session id");
    }
    const sessionId = BigInt(sessionIdHint);

    const agent = new SolanaPublicKey(input.signer);
    const programId = new SolanaPublicKey(this.solanaProgramId);
    const [session] = findSessionPda(programId, agent, sessionId);
    const info = await connection.getAccountInfo(session);
    if (!info) throw new Error("Usage session not found for signer");
    const record = decodeSessionRecord(info.data);
    if (!record) throw new Error("Failed to decode usage session account");
    if (record.agent !== agent.toBase58()) {
      throw new Error("Session owner does not match payment signer");
    }
    if (!record.active) throw new Error("Session is not active");
    if (record.balance < input.amount) {
      throw new Error(
        `Session balance too low for settlement (balance=${record.balance.toString()}, required=${input.amount.toString()})`,
      );
    }

    const mint = new SolanaPublicKey(record.token);
    const providerAddress = input.providerAddress || this.providerAddress;
    if (!providerAddress) throw new Error("Invalid settlement provider address");

    const [config] = findConfigPda(programId);
    const [settlerRecord] = findSettlerPda(programId, keypair.publicKey);
    const [vaultAuthority] = findVaultAuthorityPda(programId);
    const vaultToken = findAssociatedTokenAddress(vaultAuthority, mint);
    const providerToken = findAssociatedTokenAddress(providerAddress, mint);
    const nullifier =
      input.nullifier ??
      createHash("sha256")
        .update(`${sessionId}:${input.amount}:${Date.now()}`)
        .digest();
    const [nullifierRecord] = findNullifierPda(programId, nullifier);

    const instruction = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: config, isSigner: false, isWritable: false },
        { pubkey: settlerRecord, isSigner: false, isWritable: false },
        // writable: pays rent for the nullifier record.
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: session, isSigner: false, isWritable: true },
        { pubkey: nullifierRecord, isSigner: false, isWritable: true },
        { pubkey: vaultAuthority, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultToken, isSigner: false, isWritable: true },
        { pubkey: providerToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        // Anchor optional account: the program id signals `None`. The proof
        // gate is off unless `set_proof_verification` was called on-chain.
        { pubkey: programId, isSigner: false, isWritable: false },
      ],
      data: encodeSettle(input.amount, 0n, nullifier),
    });

    const signature = await sendAndConfirmTransaction(
      connection,
      new SolanaTransaction().add(instruction),
      [keypair],
      { commitment: "confirmed" },
    );

    return {
      transactionHash: signature,
      settledAmount: input.amount,
      sessionId: String(sessionId),
      providerAddress,
    };
  }

  async settleForSigner(
    input: SettleForSignerInput,
  ): Promise<SettlementWriteResult> {
    if (this.isSolana) {
      return this.settleSolana(input);
    }
    if (this.isStellar) {
      if (!/^G[A-Z2-7]{55}$/.test(input.signer)) {
        throw new Error("Invalid signer address for settlement");
      }
      if (input.amount <= 0n) {
        throw new Error("Settlement amount must be greater than zero");
      }
      const providerAddress = input.providerAddress || this.providerAddress;
      const client = await this.getStellarClient();
      const result = await client.settle({
        settler: this.signerAddress,
        session_id: input.sessionIdHint,
        amount: input.amount,
        provider: providerAddress,
      });
      const txHash = String(result?.txHash ?? "");
      if (!txHash) {
        throw new Error("Stellar settlement returned no transaction hash");
      }
      return {
        transactionHash: txHash,
        settledAmount: input.amount,
        sessionId: input.sessionIdHint,
        providerAddress,
      };
    }

    if (!isAddress(input.signer)) {
      throw new Error("Invalid signer address for settlement");
    }
    if (input.amount <= 0n) {
      throw new Error("Settlement amount must be greater than zero");
    }

    const resolvedSessionId = await this.resolveSessionId(
      input.sessionIdHint,
      input.signer as `0x${string}`,
    );
    const session = await this.getSession(resolvedSessionId);

    if (!session.active) {
      throw new Error("Session is not active");
    }
    if (session.agent.toLowerCase() !== input.signer.toLowerCase()) {
      throw new Error("Session owner does not match payment signer");
    }
    if (session.balance < input.amount) {
      throw new Error(
        `Session balance too low for settlement (balance=${session.balance.toString()}, required=${input.amount.toString()})`,
      );
    }

    const providerAddress = (input.providerAddress ||
      this.providerAddress) as `0x${string}`;
    if (!isAddress(providerAddress)) {
      throw new Error("Invalid settlement provider address");
    }

    const txHash = (await this.walletClient.writeContract({
      address: this.sessionVaultAddress,
      abi: SessionVaultABI,
      functionName: "settle",
      args: [resolvedSessionId, input.amount, providerAddress],
    })) as `0x${string}`;

    if (this.waitForReceipt) {
      await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    // Collect protocol fee using provider-specific tier rate
    if (isAddress(this.feeCollectorAddress)) {
      try {
        const feeTxHash = (await this.walletClient.writeContract({
          address: this.feeCollectorAddress,
          abi: FeeCollectorABI,
          functionName: "collectSettlementFeeFor",
          args: [input.amount, providerAddress],
        })) as `0x${string}`;

        if (this.waitForReceipt) {
          await this.publicClient.waitForTransactionReceipt({
            hash: feeTxHash,
          });
        }
      } catch (err) {
        // Fee collection failure should not revert the settlement
        console.warn(
          "[SettlementWriter] Fee collection failed (non-fatal):",
          err,
        );
      }
    }

    return {
      transactionHash: txHash,
      settledAmount: input.amount,
      sessionId: resolvedSessionId,
      providerAddress,
    };
  }
}
