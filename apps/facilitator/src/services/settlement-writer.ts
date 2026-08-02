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
import { sepolia, baseSepolia, base } from "viem/chains";
import {
  DEFAULT_CHAIN_ID,
  SessionVaultABI,
  FeeCollectorABI,
  getContractAddresses,
} from "@arcenpay/internal-core";

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
  5042002: baseSepolia, // Arc Testnet — USDC-native chain, uses Base Sepolia transport
};

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
  privateKey: `0x${string}`;
  chainId?: number;
  sessionVaultAddress?: `0x${string}`;
  feeCollectorAddress?: `0x${string}`;
  providerAddress?: `0x${string}`;
  waitForReceipt?: boolean;
}

export interface SettleForSignerInput {
  signer: `0x${string}`;
  amount: bigint;
  sessionIdHint: string;
  providerAddress?: `0x${string}`;
}

export interface SettlementWriteResult {
  transactionHash: `0x${string}`;
  settledAmount: bigint;
  sessionId: `0x${string}`;
  providerAddress: `0x${string}`;
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
  private readonly sessionVaultAddress: `0x${string}`;
  private readonly feeCollectorAddress: `0x${string}`;
  private readonly providerAddress: `0x${string}`;
  private readonly signerAddress: `0x${string}`;
  private readonly waitForReceipt: boolean;
  private readonly publicClient: any;
  private readonly walletClient: any;

  constructor(config: SettlementWriterConfig) {
    this.chainId = config.chainId ?? DEFAULT_CHAIN_ID;
    const chain = CHAIN_MAP[this.chainId] || baseSepolia;
    const contracts = getContractAddresses(this.chainId);

    this.sessionVaultAddress = (config.sessionVaultAddress ||
      contracts.sessionVault) as `0x${string}`;
    this.feeCollectorAddress = (config.feeCollectorAddress ||
      contracts.feeCollector) as `0x${string}`;

    const account = privateKeyToAccount(config.privateKey);
    this.signerAddress = account.address;
    this.providerAddress = (config.providerAddress ||
      account.address) as `0x${string}`;
    this.waitForReceipt = config.waitForReceipt ?? true;

    if (!isAddress(this.sessionVaultAddress)) {
      throw new Error(
        "Invalid SessionVault address for SettlementWriterService",
      );
    }
    if (!isAddress(this.providerAddress)) {
      throw new Error("Invalid provider address for SettlementWriterService");
    }

    this.publicClient = createResilientFacilitatorClient(config.rpcUrl, this.chainId) as any;

    this.walletClient = createWalletClient({
      account,
      chain,
      transport: getFacilitatorRpcTransport(config.rpcUrl, this.chainId),
    }) as any;
  }

  getSignerAddress(): `0x${string}` {
    return this.signerAddress;
  }

  getSessionVaultAddress(): `0x${string}` {
    return this.sessionVaultAddress;
  }

  async isSignerAuthorized(
    address: `0x${string}` = this.signerAddress,
  ): Promise<boolean> {
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
    if (!isAddress(input.signer)) {
      throw new Error("Invalid signer address for settlement");
    }
    if (input.amount <= 0n) {
      throw new Error("Settlement amount must be greater than zero");
    }

    const resolvedSessionId = await this.resolveSessionId(
      input.sessionIdHint,
      input.signer,
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
