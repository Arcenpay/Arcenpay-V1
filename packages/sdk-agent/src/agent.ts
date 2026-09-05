// ============================================================
//  @arcenpay/agent — AI Agent Client
//  Autonomous x402 payment negotiation with auto-topup, dispatch,
//  persistent nonce/session management, and permission controls.
// ============================================================

import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
  formatUnits,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, base } from 'viem/chains';
import { arcTestnet, X402_VERSION, X402_SCHEME, SessionVaultABI, getContractAddresses, getTokenAddress, isStellarChainId, getChainDescriptor, getStellarNetworkPassphrase, getStellarSorobanRpcUrl, normalizeX402AmountToDecimal } from './internal/core';
import type { X402Response, X402PaymentHeader, AutoTopUpConfig, AutoTopUpMode, DispatchConfig, DispatchProvider, DispatchProviderType, TopUpRequest, PersistentAgentState, PersistentStore } from './internal/core';

// ─── Re-exported types ───────────────────────────────────────────
export type {
  AutoTopUpConfig,
  AutoTopUpMode,
  DispatchConfig,
  DispatchProvider,
  DispatchProviderType,
  TopUpRequest,
  PersistentAgentState,
  PersistentStore,
} from './internal/core';

// ─── Config ───────────────────────────────────────────────────────

export interface AgentConfig {
  /** Agent's wallet private key (EVM hex for EVM chains, S… secret for Stellar). */
  privateKey: string;
  /** RPC URL for the target chain (EVM only; optional on Stellar). */
  rpcUrl?: string;
  /** Chain ID */
  chainId: number;
  /** Maximum amount to auto-approve per request (in USDC, e.g., "0.01") */
  maxAutoApprove?: string;
  /** Session vault address (if pre-funded) */
  sessionVaultAddress?: string;
  /** Auto-top-up configuration */
  autoTopUp?: AutoTopUpConfig;
  /** Dispatch configuration for approval-based top-ups */
  dispatch?: DispatchConfig;
  /** Persistent store for nonce/session data */
  store?: PersistentStore;
  /** Stellar-only: Horizon URL. Defaults from the chain registry. */
  horizonUrl?: string;
  /** Stellar-only: Soroban RPC URL. Defaults from the chain registry/env. */
  sorobanRpcUrl?: string;
  /** Stellar-only: network passphrase. Defaults from the chain registry. */
  networkPassphrase?: string;
}

export interface FetchOptions extends RequestInit {
  /** Maximum price willing to pay (decimal USDC string like "0.01", or atomic units as bigint / integer string) */
  maxPrice?: string | bigint;
  /** Whether to auto-approve payment if within maxAutoApprove */
  autoApprove?: boolean;
}

// ─── EIP-712 Constants ────────────────────────────────────────────

const PAYMENT_DOMAIN_NAME = 'ArcenPay x402 Payment';
const PAYMENT_DOMAIN_VERSION = '1';

/**
 * Stellar signature domain separation prefix. The Stellar analogue of
 * EIP-712: we sign `PREFIX + JSON.stringify({...})` so signatures are
 * distinct from arbitrary wallet signing and bound to the x402 scheme.
 */
export const STELLAR_X402_SIGNING_PREFIX = 'ArcenPay x402 Payment\n';

const PAYMENT_TYPES = {
  Payment: [
    { name: 'from', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'sessionId', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
} as const;

const CHAIN_MAP: Record<number, Chain> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
  5042002: arcTestnet,
};

const ERC20_APPROVE_ABI = [{
  type: 'function',
  name: 'approve',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
  stateMutability: 'nonpayable',
}] as const;

const PERSISTENCE_KEY = 'arcenpay_agent_state';
const BALANCE_RETRY_MAX = 3;
const BALANCE_RETRY_BASE_MS = 500;

// ─── Helpers ──────────────────────────────────────────────────────

function parseHumanUsdcAmount(value: string, field: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`[ArcenPayAgent] ${field} must be a non-empty USDC amount`);
  }
  try {
    return parseUnits(trimmed, 6);
  } catch {
    throw new Error(`[ArcenPayAgent] ${field} must be a valid USDC amount like "0.01"`);
  }
}

function parsePriceLimit(value: string | bigint, field: string): bigint {
  if (typeof value === 'bigint') return value;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`[ArcenPayAgent] ${field} must be a non-empty price limit`);
  }
  if (trimmed.includes('.')) {
    return parseHumanUsdcAmount(trimmed, field);
  }
  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(
      `[ArcenPayAgent] ${field} must be a decimal USDC string like "0.01" or an atomic-unit bigint/integer string`,
    );
  }
}

function formatUsdc(atomic: bigint): string {
  try {
    if (atomic < 0n) {
      return `-$${formatUnits(-atomic, 6)} USDC`;
    }
    return `$${formatUnits(atomic, 6)} USDC`;
  } catch {
    return `${atomic} atomic units`;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── In-Memory Store (default fallback) ───────────────────────────

class MemoryStore implements PersistentStore {
  private data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

// ─── Main Agent Class ─────────────────────────────────────────────

/**
 * ArcenPay AI agent client — autonomous x402/USDC payment negotiation.
 * `ArcenPayAgent` is kept as a documented alias.
 */
export class ArcenAgent {
  private config: AgentConfig;
  private sessionId: string | null = null;
  private totalSpent: bigint = 0n;
  private nonce: bigint = 0n;
  private publicClient: PublicClient | null;
  private walletClient: WalletClient | null;
  private account: ReturnType<typeof privateKeyToAccount>;
  private contracts: ReturnType<typeof getContractAddresses>;
  private chain: Chain;
  private store: PersistentStore;
  private dailySpent: bigint = 0n;
  private lastDailyReset: Date = new Date();
  readonly isStellar: boolean;
  /** Stellar account address (G…) when on a Stellar chain. */
  readonly stellarAddress: string | null = null;
  private stellarKeypair: any = null;
  private stellarRpcUrl: string = '';
  private stellarHorizonUrl: string = '';
  private stellarPassphrase: string = '';

  constructor(config: AgentConfig) {
    this.config = {
      maxAutoApprove: '0.01',
      ...config,
    };

    this.isStellar = isStellarChainId(config.chainId);
    const resolvedContracts = getContractAddresses(config.chainId);
    this.contracts = config.sessionVaultAddress
      ? { ...resolvedContracts, sessionVault: config.sessionVaultAddress }
      : resolvedContracts;

    this.store = config.store ?? new MemoryStore();

    if (this.isStellar) {
      // Stellar: keypair from S… secret; no viem clients.
      // Lazy-import the SDK so EVM-only consumers don't pay the bundle cost.
      const { Keypair } = require('@stellar/stellar-sdk');
      this.stellarKeypair = Keypair.fromSecret(config.privateKey);
      this.stellarAddress = this.stellarKeypair.publicKey();
      this.stellarPassphrase =
        config.networkPassphrase ?? getStellarNetworkPassphrase(config.chainId);
      this.stellarRpcUrl =
        config.sorobanRpcUrl ?? getStellarSorobanRpcUrl(config.chainId);
      this.stellarHorizonUrl =
        config.horizonUrl ??
        getChainDescriptor(config.chainId)?.rpcUrl ??
        (this.stellarPassphrase.includes('Test')
          ? 'https://horizon-testnet.stellar.org'
          : 'https://horizon.stellar.org');
      this.chain = CHAIN_MAP[config.chainId] ?? sepolia;
      this.account = privateKeyToAccount(
        ('0x' + '0'.repeat(64)) as `0x${string}`,
      );
      this.publicClient = null;
      this.walletClient = null;
      return;
    }

    this.chain = CHAIN_MAP[config.chainId] ?? sepolia;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    if (!config.rpcUrl) {
      throw new Error('[ArcenPayAgent] rpcUrl is required for EVM chains.');
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
  }

  // ─── Stellar helpers ──────────────────────────────────────────

  private async getStellarClient() {
    const { contract: stellarContract } = await import('@stellar/stellar-sdk');
    return (stellarContract as any).Client.from({
      contractId: this.contracts.sessionVault,
      networkPassphrase: this.stellarPassphrase,
      rpcUrl: this.stellarRpcUrl,
      publicKey: this.stellarAddress,
    });
  }

  private async getStellarHorizonServer() {
    const { Horizon } = await import('@stellar/stellar-sdk');
    return new Horizon.Server(this.stellarHorizonUrl);
  }

  /**
   * Resolves the Stellar SAC contract id (C…) for a USDC asset issuer (G…).
   *
   * The SessionVault Soroban contract calls `sac_transfer` on the `token`
   * Address it is given, which instantiates a token client on that address —
   * so `fund_session`/`top_up` require the C… SAC contract id, NOT the G…
   * issuer. Classic assets (USDC) get their SAC contract id from
   * `Asset.contractId(networkPassphrase)`.
   */
  private async resolveStellarSacContractId(assetIssuer: string): Promise<string> {
    const { Asset } = await import('@stellar/stellar-sdk');
    const asset = new Asset('USDC', assetIssuer);
    return (asset as unknown as { contractId(passphrase: string): string }).contractId(
      this.stellarPassphrase,
    );
  }

  /**
   * Builds the canonical Stellar x402 signing payload string and signs it
   * with the agent keypair. Returns { signature (base64), message }.
   */
  private async signStellarPayment(message: Record<string, unknown>): Promise<{
    signature: string;
    messageText: string;
  }> {
    const messageText =
      STELLAR_X402_SIGNING_PREFIX + JSON.stringify(message);
    const signature = this.stellarKeypair.sign(Buffer.from(messageText, 'utf8'));
    return { signature: signature.toString('base64'), messageText };
  }

  /**
   * Sends a USDC SAC transfer from the agent wallet to `destination`,
   * then returns the tx hash. Used by fundSession/topUp on Stellar.
   */
  private async sendStellarSacTransfer(
    destination: string,
    amountHuman: string,
  ): Promise<string> {
    const { Asset, TransactionBuilder, Operation, BASE_FEE } =
      await import('@stellar/stellar-sdk');
    const server = await this.getStellarHorizonServer();
    const tokenAddress = getTokenAddress(this.config.chainId, 'USDC');
    if (!tokenAddress) {
      throw new Error(
        `[ArcenPayAgent] No USDC asset configured for chain ${this.config.chainId}`,
      );
    }
    const asset = new Asset('USDC', tokenAddress);
    const account = await server.loadAccount(this.stellarAddress!);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarPassphrase,
    })
      .addOperation(
        Operation.payment({ destination, asset, amount: amountHuman }),
      )
      .setTimeout(300)
      .build();
    tx.sign(this.stellarKeypair);
    const submitted = await server.submitTransaction(tx);
    return submitted.hash;
  }

  // ─── Persistence ──────────────────────────────────────────

  /** Restores nonce, sessionId, and totalSpent from persistent store */
  async restore(): Promise<void> {
    try {
      const raw = await this.store.get(PERSISTENCE_KEY);
      if (!raw) return;
      const state: PersistentAgentState = JSON.parse(raw);
      this.nonce = BigInt(state.nonce);
      this.sessionId = state.sessionId;
      this.totalSpent = BigInt(state.totalSpent);
      console.log(
        `[ArcenPayAgent] Restored state: nonce=${this.nonce}, sessionId=${this.sessionId?.slice(0, 10)}…, totalSpent=${formatUsdc(this.totalSpent)}`,
      );
    } catch (err) {
      console.warn('[ArcenPayAgent] Failed to restore persisted state, starting fresh:', err);
    }
  }

  /** Persists nonce, sessionId, and totalSpent */
  private async persist(): Promise<void> {
    const state: PersistentAgentState = {
      nonce: this.nonce.toString(),
      sessionId: this.sessionId,
      totalSpent: this.totalSpent.toString(),
      lastPersistedAt: new Date().toISOString(),
    };
    try {
      await this.store.set(PERSISTENCE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[ArcenPayAgent] Failed to persist state:', err);
    }
  }

  // ─── Properties ──────────────────────────────────────────

  get address(): string {
    return this.isStellar ? this.stellarAddress! : this.account.address;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  get currentNonce(): bigint {
    return this.nonce;
  }

  // ─── Session Funding ─────────────────────────────────────

  /**
   * Pre-funds a ZKVUB session vault with USDC
   *
   * EVM steps:
   * 1. Approve SessionVault to spend `amount` of USDC
   * 2. Call SessionVault.fundSession(amount, token)
   * 3. Store returned sessionId and persist
   *
   * Stellar steps:
   * 1. SAC transfer USDC to the vault contract
   * 2. Call SessionVault.fund_session(agent, amount, token)
   * 3. Store returned sessionId and persist
   *
   * @param amount Amount to deposit (human-readable, e.g., "10" = 10 USDC)
   * @returns Session ID
   */
  async fundSession(amount: string): Promise<string> {
    const amountAtomic = parseHumanUsdcAmount(amount, 'amount');
    const usdcAddress = getTokenAddress(this.config.chainId, 'USDC') ?? undefined;
    const vaultAddress = this.contracts.sessionVault as `0x${string}`;

    if (!usdcAddress) {
      throw new Error(`No USDC address configured for chain ${this.config.chainId}`);
    }

    if (this.isStellar) {
      // Step 1: SAC transfer USDC to the vault (agent signs with its keypair).
      await this.sendStellarSacTransfer(vaultAddress, amount);
      // Step 2: Invoke fund_session on the Soroban vault. The vault's
      // `sac_transfer` requires the C… SAC contract id, not the G… issuer.
      const tokenContractId = await this.resolveStellarSacContractId(usdcAddress);
      const client = await this.getStellarClient();
      const result = await client.fund_session({
        agent: this.stellarAddress,
        amount: amountAtomic,
        token: tokenContractId,
      });
      const sessionId = String(result?.result ?? '');
      if (!sessionId) {
        throw new Error(
          '[ArcenPayAgent] fundSession() succeeded on-chain but no session id was returned',
        );
      }
      this.sessionId = sessionId;
      await this.persist();
      console.log(
        `[ArcenPayAgent] Session funded: ${amount} USDC → ${this.sessionId}`,
      );
      return this.sessionId;
    }

    // Step 1: Approve SessionVault to spend USDC
    const approveHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account,
      address: usdcAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [vaultAddress, amountAtomic],
    } as any);

    console.log(`[ArcenPayAgent] USDC approve tx: ${approveHash}`);
    await this.publicClient!.waitForTransactionReceipt({ hash: approveHash });

    // Step 2: Call SessionVault.fundSession()
    const fundHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account,
      address: vaultAddress,
      abi: SessionVaultABI,
      functionName: 'fundSession',
      args: [amountAtomic, usdcAddress],
    } as any);

    console.log(`[ArcenPayAgent] Fund session tx: ${fundHash}`);
    const receipt = await this.publicClient!.waitForTransactionReceipt({ hash: fundHash });

    let sessionId: string | null = null;
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: SessionVaultABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === 'SessionFunded') {
          sessionId = decoded.args.sessionId;
          break;
        }
      } catch {
        // Ignore unrelated logs.
      }
    }

    if (!sessionId) {
      throw new Error(
        '[ArcenPayAgent] fundSession() succeeded on-chain but SessionFunded event could not be decoded',
      );
    }

    this.sessionId = sessionId;
    await this.persist();

    console.log(`[ArcenPayAgent] Session funded: ${amount} USDC → ${this.sessionId}`);
    return this.sessionId;
  }

  // ─── Fetch with x402 Auto-Payment ────────────────────────

  /**
   * Drop-in replacement for fetch() with automatic x402 payment negotiation.
   * Now includes auto-topup with dispatch support.
   */
  async fetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const { maxPrice, autoApprove = true, ...fetchOptions } = options;

    // Step 1: Make initial request
    const response = await globalThis.fetch(url, fetchOptions);

    // Step 2: Check if 402 Payment Required
    if (response.status !== 402) {
      return response;
    }

    // Step 3: Parse x402 response
    const x402Response: X402Response = await response.json();
    console.log(`[ArcenPayAgent] Received 402: ${x402Response.error}`);

    // Step 4: Evaluate payment options
    const paymentOption = x402Response.accepts[0];
    if (!paymentOption) {
      throw new Error('No payment options available');
    }

    const requiredAmount = BigInt(paymentOption.maxAmountRequired);
    const maxAutoApproveAmount = parseHumanUsdcAmount(
      this.config.maxAutoApprove ?? '0',
      'maxAutoApprove',
    );

    // Step 5: Auto-approve check (with human-readable error)
    if (autoApprove && requiredAmount > maxAutoApproveAmount) {
      throw new Error(
        `Payment amount ${formatUsdc(requiredAmount)} exceeds auto-approve limit ${formatUsdc(maxAutoApproveAmount)}`,
      );
    }

    if (maxPrice !== undefined && requiredAmount > parsePriceLimit(maxPrice, 'maxPrice')) {
      throw new Error(
        `Payment amount ${formatUsdc(requiredAmount)} exceeds max price limit`,
      );
    }

    // Step 6: Check daily spend limit for auto-topup
    this.resetDailySpendIfNeeded();
    if (this.config.autoTopUp?.mode !== 'off') {
      const dailyLimit = parseHumanUsdcAmount(this.config.autoTopUp?.dailyLimit ?? '0', 'dailyLimit');
      if (dailyLimit > 0n && this.dailySpent + requiredAmount > dailyLimit) {
        throw new Error(
          `Daily spend limit reached: ${formatUsdc(this.dailySpent)} already spent, ${formatUsdc(requiredAmount)} needed, limit is ${formatUsdc(dailyLimit)}`,
        );
      }
    }

    // Step 7: Check balance before constructing payment (FIXED: check BEFORE nonce)
    const balance = await this.getBalanceWithRetry();
    if (balance < requiredAmount) {
      // Attempt auto-topup if configured
      const toppedUp = await this.tryAutoTopUp(requiredAmount - balance, url);
      if (!toppedUp) {
        throw new Error(
          `[ArcenPayAgent] Insufficient session balance: have ${formatUsdc(balance)}, need ${formatUsdc(requiredAmount)}. ` +
          `Call fundSession() to top up before retrying.`,
        );
      }
    }

    // Step 8: Construct and sign payment with EIP-712 (nonce incremented AFTER balance check)
    const paymentNonce = this.nonce;
    const paymentHeader = await this.constructPayment(paymentOption);
    this.nonce += 1n;
    await this.persist(); // Persist after nonce increment

    // Step 9: Resubmit request with X-PAYMENT header
    const paidResponse = await globalThis.fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'X-PAYMENT': paymentHeader,
      },
    });

    // Nonces are single-use. A new nonce is used for the next attempt automatically.
    if (paidResponse.ok) {
      this.totalSpent += requiredAmount;
      this.dailySpent += requiredAmount;
      console.log(
        `[ArcenPayAgent] Payment settled with nonce ${paymentNonce}. Total spent: ${formatUsdc(this.totalSpent)}, next nonce: ${this.nonce}`,
      );
    } else {
      console.warn(
        `[ArcenPayAgent] Paid request returned non-2xx (${paidResponse.status}). ` +
        `A fresh nonce will be used on the next attempt.`,
      );
    }

    return paidResponse;
  }

  // ─── Balance Queries ─────────────────────────────────────

  /**
   * Returns current session vault balance from on-chain with retry logic.
   * No longer silently returns 0 on failure.
   */
  async getBalance(): Promise<bigint> {
    return this.getBalanceWithRetry();
  }

  private async getBalanceWithRetry(): Promise<bigint> {
    let lastError: unknown;

    if (this.isStellar) {
      for (let attempt = 0; attempt < BALANCE_RETRY_MAX; attempt++) {
        try {
          const client = await this.getStellarClient();
          const result = await client.get_agent_balance({
            agent: this.stellarAddress,
          });
          return BigInt(result?.result ?? 0);
        } catch (err) {
          lastError = err;
          if (attempt < BALANCE_RETRY_MAX - 1) {
            const delay = BALANCE_RETRY_BASE_MS * Math.pow(2, attempt);
            console.warn(
              `[ArcenPayAgent] Stellar balance query attempt ${attempt + 1}/${BALANCE_RETRY_MAX} failed, retrying in ${delay}ms…`,
            );
            await sleep(delay);
          }
        }
      }
      throw new Error(
        `[ArcenPayAgent] Balance query failed after ${BALANCE_RETRY_MAX} attempts: ${lastError}`,
      );
    }

    for (let attempt = 0; attempt < BALANCE_RETRY_MAX; attempt++) {
      try {
        const balance = await this.publicClient!.readContract({
          address: this.contracts.sessionVault as `0x${string}`,
          abi: SessionVaultABI,
          functionName: 'getAgentBalance',
          args: [this.account.address],
        });
        return balance as bigint;
      } catch (err) {
        lastError = err;
        if (attempt < BALANCE_RETRY_MAX - 1) {
          const delay = BALANCE_RETRY_BASE_MS * Math.pow(2, attempt);
          console.warn(
            `[ArcenPayAgent] Balance query attempt ${attempt + 1}/${BALANCE_RETRY_MAX} failed, retrying in ${delay}ms…`,
          );
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `[ArcenPayAgent] Balance query failed after ${BALANCE_RETRY_MAX} attempts: ${lastError}`,
    );
  }

  // ─── Usage Reporting ─────────────────────────────────────

  /**
   * Returns aggregated consumption data for a session
   */
  async getUsageReport(sessionId?: string): Promise<{
    sessionId: string;
    callCount: number;
    totalSpent: bigint;
    remainingBalance: bigint;
  }> {
    const balance = await this.getBalance();
    return {
      sessionId: sessionId ?? this.sessionId ?? 'none',
      callCount: Number(this.nonce),
      totalSpent: this.totalSpent,
      remainingBalance: balance,
    };
  }

  // ─── Auto-Topup & Dispatch ───────────────────────────────

  /**
   * Tops up an existing session with additional USDC.
   * Uses SessionVault.topUp() on-chain.
   */
  async topUpSession(sessionId: string, amount: string): Promise<void> {
    const amountAtomic = parseHumanUsdcAmount(amount, 'amount');
    const usdcAddress = getTokenAddress(this.config.chainId, 'USDC') ?? undefined;
    const vaultAddress = this.contracts.sessionVault as `0x${string}`;

    if (!usdcAddress) {
      throw new Error(`No USDC address configured for chain ${this.config.chainId}`);
    }

    if (this.isStellar) {
      // SAC transfer to the vault, then invoke top_up on the Soroban vault.
      await this.sendStellarSacTransfer(vaultAddress, amount);
      const client = await this.getStellarClient();
      await client.top_up({
        agent: this.stellarAddress,
        session_id: sessionId,
        amount: amountAtomic,
      });
      console.log(
        `[ArcenPayAgent] Session ${sessionId.slice(0, 10)}… topped up with ${amount} USDC (Stellar)`,
      );
      return;
    }

    // Approve
    const approveHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account,
      address: usdcAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [vaultAddress, amountAtomic],
    } as any);

    console.log(`[ArcenPayAgent] Top-up approve tx: ${approveHash}`);
    await this.publicClient!.waitForTransactionReceipt({ hash: approveHash });

    // Top up
    const topUpHash = await this.walletClient!.writeContract({
      chain: this.chain,
      account: this.account,
      address: vaultAddress,
      abi: SessionVaultABI,
      functionName: 'topUp',
      args: [sessionId as `0x${string}`, amountAtomic],
    } as any);

    console.log(`[ArcenPayAgent] Top-up tx: ${topUpHash}`);
    await this.publicClient!.waitForTransactionReceipt({ hash: topUpHash });

    console.log(`[ArcenPayAgent] Session ${sessionId.slice(0, 10)}… topped up with ${amount} USDC`);
  }

  /**
   * Sends a dispatch approval request to configured providers
   * (e.g., Telegram, Discord) asking user to approve a top-up.
   */
  async sendDispatchRequest(amount: string, reason: string): Promise<TopUpRequest[]> {
    const providers = this.config.dispatch?.providers ?? [];
    const enabled = providers.filter((p) => p.enabled);

    if (enabled.length === 0) {
      console.warn('[ArcenPayAgent] No dispatch providers configured. Top-up requires manual intervention.');
      return [];
    }

    const requests: TopUpRequest[] = [];

    for (const provider of enabled) {
      const requestId = `topup_${Date.now()}_${randomUUID()}`;
      const target = provider.botToken
        ? `${provider.chatId}` : provider.webhookUrl
        ? provider.webhookUrl : provider.email ?? 'unknown';

      const topUpRequest: TopUpRequest = {
        id: requestId,
        agentAddress: this.address,
        amount,
        reason,
        status: 'pending',
        createdAt: new Date().toISOString(),
        provider: provider.type,
        providerTarget: target,
      };

      try {
        await this.sendProviderNotification(provider, topUpRequest);
        requests.push(topUpRequest);
        console.log(`[ArcenPayAgent] Dispatch request sent via ${provider.type}: ${amount} USDC`);
      } catch (err) {
        console.error(`[ArcenPayAgent] Failed to send dispatch via ${provider.type}:`, err);
      }
    }

    // Store pending requests (in-memory; production would persist to DB)
    this.pendingDispatchRequests.push(...requests);

    return requests;
  }

  private pendingDispatchRequests: TopUpRequest[] = [];

  /** Retrieves all pending dispatch requests */
  getPendingDispatchRequests(): TopUpRequest[] {
    return this.pendingDispatchRequests.filter((r) => r.status === 'pending');
  }

  /** Marks a dispatch request as approved or denied */
  resolveDispatchRequest(requestId: string, approved: boolean): TopUpRequest | null {
    const req = this.pendingDispatchRequests.find((r) => r.id === requestId);
    if (!req) return null;
    req.status = approved ? 'approved' : 'denied';
    req.respondedAt = new Date().toISOString();
    return req;
  }

  /**
   * Sends a notification to a dispatch provider.
   * Currently supports Telegram bot integration.
   */
  private async sendProviderNotification(
    provider: DispatchProvider,
    request: TopUpRequest,
  ): Promise<void> {
    switch (provider.type) {
      case 'telegram': {
        const botToken = provider.botToken || process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          throw new Error('Telegram botToken not configured on provider');
        }
        if (!provider.chatId) {
          throw new Error('Telegram chatId not configured on provider');
        }
        const message = this.formatDispatchMessage(request);
        const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: provider.chatId,
            text: message,
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Approve', callback_data: `arcenpay:approve:${request.id}` },
                  { text: '❌ Deny', callback_data: `arcenpay:deny:${request.id}` },
                ],
              ],
            },
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Telegram API error: ${response.status} ${body}`);
        }
        break;
      }
      case 'discord': {
        const webhookUrl = provider.webhookUrl || process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
          throw new Error('Discord webhookUrl not configured on provider');
        }
        const message = `🔔 **ArcenPay Agent Top-Up Request**\n` +
          `Agent: \`${request.agentAddress}\`\n` +
          `Amount: ${formatUsdc(BigInt(request.amount))}\n` +
          `Reason: ${request.reason}\n` +
          `Request ID: \`${request.id}\`\n` +
          `Approve with: \`/arcenpay approve ${request.id}\`\n` +
          `Deny with: \`/arcenpay deny ${request.id}\``;

        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: message }),
        });
        break;
      }
      case 'slack': {
        const webhookUrl = provider.webhookUrl || process.env.SLACK_WEBHOOK_URL;
        if (!webhookUrl) {
          throw new Error('Slack webhookUrl not configured on provider');
        }
        const message = `*ArcenPay Agent Top-Up Request*\n` +
          `Agent: \`${request.agentAddress}\`\n` +
          `Amount: ${formatUsdc(BigInt(request.amount))}\n` +
          `Reason: ${request.reason}\n` +
          `Request ID: \`${request.id}\``;

        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: message }),
        });
        break;
      }
      case 'email': {
        const target = provider.email;
        if (!target) {
          throw new Error('Email address not configured on provider');
        }
        console.log(`[ArcenPayAgent] Dispatch email to ${target}: Top-up ${request.amount} USDC for agent ${request.agentAddress}`);
        break;
      }
      default:
        console.warn(`[ArcenPayAgent] Unsupported provider type: ${provider.type}`);
    }
  }

  private formatDispatchMessage(request: TopUpRequest): string {
    const shortAddr = `${request.agentAddress.slice(0, 6)}…${request.agentAddress.slice(-4)}`;
    return `<b>💰 ArcenPay Agent — Top-Up Request</b>\n\n` +
      `<b>Agent:</b> <code>${shortAddr}</code>\n` +
      `<b>Amount:</b> ${formatUsdc(BigInt(request.amount))}\n` +
      `<b>Reason:</b> ${request.reason}\n` +
      `<b>Request ID:</b> <code>${request.id}</code>\n\n` +
      `<i>Tap one of the buttons below:</i>`;
  }

  /**
   * Tries to auto-topup the session if balance is below what's needed.
   * Returns true if the top-up succeeded, false otherwise.
   */
  private async tryAutoTopUp(deficit: bigint, resource: string): Promise<boolean> {
    if (!this.config.autoTopUp || this.config.autoTopUp.mode === 'off') {
      return false;
    }

    if (!this.sessionId) {
      console.warn('[ArcenPayAgent] Cannot auto-topup: no active session');
      return false;
    }

    const perTxnLimit = parseHumanUsdcAmount(
      this.config.autoTopUp.perTxnLimit,
      'perTxnLimit',
    );

    // Add a small buffer (10%) to cover subsequent calls
    const topUpAmount = deficit * 110n / 100n;
    const cappedAmount = topUpAmount > perTxnLimit ? perTxnLimit : topUpAmount;

    const mode = this.config.autoTopUp.mode;

    if (mode === 'auto') {
      // Auto mode: top up immediately without user approval
      const amountUsdc = formatUnits(cappedAmount, 6);
      console.log(`[ArcenPayAgent] Auto-topping up ${amountUsdc} USDC…`);
      try {
        await this.topUpSession(this.sessionId, amountUsdc);
        console.log(`[ArcenPayAgent] Auto-topup complete: ${amountUsdc} USDC`);
        return true;
      } catch (err) {
        console.error('[ArcenPayAgent] Auto-topup failed:', err);
        return false;
      }
    }

    if (mode === 'dispatch') {
      // Dispatch mode: send approval request to user
      const amountUsdc = formatUnits(cappedAmount, 6);
      console.log(`[ArcenPayAgent] Dispatching top-up request for ${amountUsdc} USDC…`);
      const requests = await this.sendDispatchRequest(
        cappedAmount.toString(),
        `Agent needs ${formatUsdc(deficit)} USDC for resource: ${resource}`,
      );

      if (requests.length === 0) {
        console.error('[ArcenPayAgent] Dispatch failed: no providers responded');
        return false;
      }

      // Wait for user response (with timeout)
      const timeoutMs = (this.config.dispatch?.cooldownSeconds ?? 120) * 1000;
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        await sleep(2000); // Poll every 2 seconds

        for (const req of requests) {
          if (req.status === 'approved') {
            const resolved = this.resolveDispatchRequest(req.id, true);
            if (resolved && resolved.status === 'approved') {
              try {
                await this.topUpSession(this.sessionId!, amountUsdc);
                console.log(`[ArcenPayAgent] Dispatch top-up approved and complete: ${amountUsdc} USDC`);
                return true;
              } catch (err) {
                console.error('[ArcenPayAgent] Dispatch top-up failed after approval:', err);
                return false;
              }
            }
          }
        }
      }

      console.warn(`[ArcenPayAgent] Dispatch request timed out after ${timeoutMs / 1000}s`);
      return false;
    }

    return false;
  }

  // ─── Daily Spend Management ──────────────────────────────

  private resetDailySpendIfNeeded(): void {
    const now = new Date();
    const isNewDay =
      now.getUTCDate() !== this.lastDailyReset.getUTCDate() ||
      now.getUTCMonth() !== this.lastDailyReset.getUTCMonth() ||
      now.getUTCFullYear() !== this.lastDailyReset.getUTCFullYear();

    if (isNewDay) {
      this.dailySpent = 0n;
      this.lastDailyReset = now;
    }
  }

  /** Returns current daily spend */
  getDailySpent(): bigint {
    this.resetDailySpendIfNeeded();
    return this.dailySpent;
  }

  /**
   * Checks if balance is below the configured threshold and tops up if needed.
   * Call this periodically or before known expensive operations.
   */
  async ensureBalance(): Promise<{
    balance: bigint;
    threshold: bigint;
    toppedUp: boolean;
  }> {
    const balance = await this.getBalance();
    const threshold = this.config.autoTopUp
      ? parseHumanUsdcAmount(this.config.autoTopUp.threshold, 'threshold')
      : 0n;

    if (balance >= threshold || !this.config.autoTopUp || this.config.autoTopUp.mode === 'off') {
      return { balance, threshold, toppedUp: false };
    }

    const deficit = threshold - balance;
    const toppedUp = await this.tryAutoTopUp(deficit, 'proactive balance maintenance');

    return {
      balance: toppedUp ? await this.getBalance() : balance,
      threshold,
      toppedUp,
    };
  }

  // ─── Permission Management ───────────────────────────────

  /** Returns the current agent permission configuration */
  getPermissions(): {
    autoTopUp: AutoTopUpConfig;
    dispatch: DispatchConfig;
    dailySpent: bigint;
    dailyLimit: bigint;
  } {
    this.resetDailySpendIfNeeded();
    return {
      autoTopUp: this.config.autoTopUp ?? { mode: 'off', dailyLimit: '0', perTxnLimit: '0', threshold: '0' },
      dispatch: this.config.dispatch ?? { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 },
      dailySpent: this.dailySpent,
      dailyLimit: this.config.autoTopUp
        ? parseHumanUsdcAmount(this.config.autoTopUp.dailyLimit, 'dailyLimit')
        : 0n,
    };
  }

  /** Updates auto-topup configuration at runtime */
  updateAutoTopUp(config: Partial<AutoTopUpConfig>): void {
    this.config.autoTopUp = { ...(this.config.autoTopUp ?? { mode: 'off' as const, dailyLimit: '0', perTxnLimit: '0', threshold: '0' }), ...config };
    console.log('[ArcenPayAgent] Auto-topup config updated:', this.config.autoTopUp);
  }

  /** Updates dispatch configuration at runtime */
  updateDispatch(config: Partial<DispatchConfig>): void {
    this.config.dispatch = { ...(this.config.dispatch ?? { enabled: false, providers: [], cooldownSeconds: 120, maxRetries: 3 }), ...config };
    console.log('[ArcenPayAgent] Dispatch config updated');
  }

  // ─── Payment Construction (EIP-712 / Stellar) ─────────────

  private async constructPayment(option: X402Response['accepts'][0]): Promise<string> {
    const timestamp = BigInt(Date.now());

    if (this.isStellar) {
      const from = this.stellarAddress!;
      // The verifier (sdk-node middleware) rebuilds the signed message with
      // the amount normalized to a decimal string. Sign the SAME string so
      // atomic-unit 402 options ("10000") don't produce a signature mismatch.
      const amountDecimal = normalizeX402AmountToDecimal(option.maxAmountRequired);
      const message = {
        from,
        amount: amountDecimal,
        resource: option.resource,
        sessionId: this.sessionId ?? '',
        nonce: this.nonce.toString(),
        timestamp: timestamp.toString(),
        chainId: this.config.chainId,
      };
      const { signature } = await this.signStellarPayment(message);
      const payload: X402PaymentHeader = {
        version: X402_VERSION,
        scheme: option.scheme,
        network: option.network,
        payload: JSON.stringify({
          from,
          amount: amountDecimal,
          payTo: option.payTo,
          resource: option.resource,
          sessionId: this.sessionId,
          nonce: this.nonce.toString(),
          timestamp: timestamp.toString(),
          chainId: this.config.chainId,
        }),
        signature,
      };
      return Buffer.from(JSON.stringify(payload)).toString('base64');
    }

    const message = {
      from: this.account.address,
      amount: BigInt(option.maxAmountRequired),
      resource: option.resource,
      sessionId: this.sessionId ?? '',
      nonce: this.nonce,
      timestamp,
    };

    const signature = await this.walletClient!.signTypedData({
      account: this.account,
      domain: {
        name: PAYMENT_DOMAIN_NAME,
        version: PAYMENT_DOMAIN_VERSION,
        chainId: BigInt(this.config.chainId),
      },
      types: PAYMENT_TYPES,
      primaryType: 'Payment',
      message,
    } as any);

    const payload: X402PaymentHeader = {
      version: X402_VERSION,
      scheme: option.scheme,
      network: option.network,
      payload: JSON.stringify({
        from: this.account.address,
        amount: option.maxAmountRequired,
        payTo: option.payTo,
        resource: option.resource,
        sessionId: this.sessionId,
        nonce: this.nonce.toString(),
        timestamp: timestamp.toString(),
      }),
      signature,
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}

/** @alias ArcenAgent — ArcenPay-branded alias */
export { ArcenAgent as ArcenPayAgent };
