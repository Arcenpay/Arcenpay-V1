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
  getStellarNetworkPassphrase,
  getStellarSorobanRpcUrl,
} from "@arcenpay/internal-core";
import { Keypair } from "@stellar/stellar-sdk";

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
  private readonly publicClient: any;
  private readonly walletClient: any;
  private stellarKeypair: any = null;
  private stellarRpcUrl: string = "";
  private stellarPassphrase: string = "";

  constructor(config: SettlementWriterConfig) {
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    this.isStellar = getChainFamily(this.chainId) === "stellar";
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

  async settleForSigner(
    input: SettleForSignerInput,
  ): Promise<SettlementWriteResult> {
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
