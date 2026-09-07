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
import { arcTestnet, botMainnet, botTestnet, X402_VERSION, X402_SCHEME, SessionVaultABI, getContractAddresses, getTokenAddress, isStellarChainId, getChainDescriptor, getStellarNetworkPassphrase, getStellarSorobanRpcUrl, normalizeX402AmountToDecimal } from './internal/core';
import type {
  X402Response,
  X402PaymentHeader,
  AutoTopUpConfig,
  AutoTopUpMode,
  DispatchConfig,
  DispatchProvider,
  DispatchProviderType,
  TopUpRequest,
  PersistentAgentState,
  PersistentStore,
  AgenticPaymentLinkSpec,
  AgentPaymentReceipt,
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
  ArcenPayAgentMandate,
  MandateScope,
  ArcenPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  EscrowMode,
  EscrowTerms,
  ProviderCommitment,
  SettlementConfirmation,
  DisputeClaim,
  DisputeReceipt,
  DisputeReason,
  MandateRevocationConfig,
  MandateStatus,
  EscrowReservationStatus,
  EscrowReservation,
} from './internal/core';
import {
  createAgentMandate,
  signAgentMandate,
  verifyAgentMandate,
  isScopeSubset,
} from './auth/mandate';
import { ArcenPolicyEvaluator } from './auth/policy';
import {
  computeExactHash,
  verifyCommitment as verifyCommitmentEngine,
} from './escrow/verifier';

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
  AgenticPaymentLinkSpec,
  AgentPaymentReceipt,
  CreateAgentPaymentLinkParams,
  PayPaymentLinkOptions,
  ArcenPayAgentMandate,
  MandateScope,
  ArcenPolicy,
  PolicyEvaluationContext,
  PolicyEvaluationResult,
  EscrowMode,
  EscrowTerms,
  ProviderCommitment,
  SettlementConfirmation,
  DisputeClaim,
  DisputeReceipt,
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
  /** Maximum total daily spend ceiling (in USDC, e.g. "50.00" or 50) */
  maxDailySpend?: string | number;
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
  /** Optional ArcenPay API base URL (e.g., 'https://api.arcenpay.xyz' or 'http://localhost:3300') */
  apiUrl?: string;
  /** Optional API key for authenticated merchant/provider operations (such as creating payment links) */
  apiKey?: string;
  /** Optional active delegation mandate (AAM) for the agent */
  mandate?: ArcenPayAgentMandate;
  /** Optional policies to enforce on transactions */
  policies?: ArcenPolicy[];
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
  677: botMainnet,
  968: botTestnet,
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

const ERC20_TRANSFER_ABI = [{
  type: 'function',
  name: 'transfer',
  inputs: [
    { name: 'to', type: 'address' },
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
  readonly apiUrl: string;
  private stellarKeypair: any = null;
  private stellarRpcUrl: string = '';
  private stellarHorizonUrl: string = '';
  private stellarPassphrase: string = '';
  private mandate: ArcenPayAgentMandate | null = null;
  private policyEvaluator: ArcenPolicyEvaluator;
  private pendingCommitments = new Map<string, ProviderCommitment>();

  constructor(config: AgentConfig) {
    this.config = {
      maxAutoApprove: '0.01',
      ...config,
    };

    this.apiUrl = (
      config.apiUrl ??
      'https://api.arcenpay.com'
    ).replace(/\/+$/, '');

    this.isStellar = isStellarChainId(config.chainId);
    const resolvedContracts = getContractAddresses(config.chainId);
    this.contracts = config.sessionVaultAddress
      ? { ...resolvedContracts, sessionVault: config.sessionVaultAddress }
      : resolvedContracts;

    this.store = config.store ?? new MemoryStore();
    this.policyEvaluator = new ArcenPolicyEvaluator(config.policies);
    if (config.mandate) {
      this.mandate = config.mandate;
    }

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
        '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`,
      );
      this.publicClient = null;
      this.walletClient = null;
      return;
    }

    this.chain = CHAIN_MAP[config.chainId] ?? sepolia;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    const defaultRpc = this.chain.rpcUrls?.default?.http?.[0];
    const rpcUrl = config.rpcUrl || defaultRpc;
    if (!rpcUrl) {
      throw new Error('[ArcenPayAgent] rpcUrl is required for EVM chains.');
    }

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(rpcUrl),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(rpcUrl),
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
   * Sends a SAC / Stellar asset transfer from the agent wallet to `destination`,
   * then returns the tx hash.
   */
  private async sendStellarSacTransfer(
    destination: string,
    amountHuman: string,
    currency: string = 'USDC',
    customTokenAddress?: string,
  ): Promise<string> {
    const { Asset, TransactionBuilder, Operation, BASE_FEE } =
      await import('@stellar/stellar-sdk');
    const server = await this.getStellarHorizonServer();
    let asset: any;
    if (currency.toUpperCase() === 'XLM' || customTokenAddress === 'native') {
      asset = Asset.native();
    } else {
      const issuerOrAddress =
        customTokenAddress ??
        getTokenAddress(this.config.chainId, currency) ??
        getTokenAddress(this.config.chainId, 'USDC');
      if (!issuerOrAddress) {
        throw new Error(
          `[ArcenPayAgent] No ${currency} asset configured for chain ${this.config.chainId}`,
        );
      }
      asset = new Asset(currency, issuerOrAddress);
    }
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

  get chainId(): number {
    return this.config.chainId;
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
    const dailyLimit = this.getDailySpendLimit();
    if (dailyLimit > 0n && this.dailySpent + requiredAmount > dailyLimit) {
      throw new Error(
        `[ArcenPayAgent] Daily spend limit reached: ${formatUsdc(this.dailySpent)} already spent, ${formatUsdc(requiredAmount)} needed, limit is ${formatUsdc(dailyLimit)}.`,
      );
    }

    // Step 7: Check balance before constructing payment (FIXED: check BEFORE nonce)
    const balance = await this.getBalance();
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

  /** Returns the configured daily spend limit in atomic units, or 0n if unconfigured. */
  getDailySpendLimit(): bigint {
    if (this.config.maxDailySpend !== undefined) {
      return parseHumanUsdcAmount(String(this.config.maxDailySpend), 'maxDailySpend');
    }
    if (this.config.autoTopUp?.dailyLimit) {
      return parseHumanUsdcAmount(this.config.autoTopUp.dailyLimit, 'dailyLimit');
    }
    return 0n;
  }

  /** Returns current daily spend in atomic units */
  getDailySpent(): bigint {
    this.resetDailySpendIfNeeded();
    return this.dailySpent;
  }

  /** Returns total spent across all operations in atomic units */
  getTotalSpent(): bigint {
    return this.totalSpent;
  }

  /** Returns a structured spend summary for agent monitoring, logging, and budget audits. */
  getSpendSummary(): {
    dailySpent: string;
    totalSpent: string;
    dailyLimit?: string;
    maxAutoApprove?: string;
  } {
    const dailyLimit = this.getDailySpendLimit();
    return {
      dailySpent: formatUsdc(this.getDailySpent()),
      totalSpent: formatUsdc(this.totalSpent),
      dailyLimit: dailyLimit > 0n ? formatUsdc(dailyLimit) : undefined,
      maxAutoApprove: this.config.maxAutoApprove,
    };
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

  // ─── Agentic Payment Links ────────────────────────────────

  /**
   * Resolves an ArcenPay payment link (by full URL or slug) into an AgenticPaymentLinkSpec.
   * Sends Accept: application/json to negotiate machine-readable specifications.
   */
  async resolvePaymentLink(urlOrSlug: string): Promise<AgenticPaymentLinkSpec> {
    const trimmed = urlOrSlug.trim();
    let targetUrl: string;

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      const parsed = new URL(trimmed);
      if (parsed.pathname.includes('/spec')) {
        targetUrl = trimmed;
      } else if (parsed.pathname.includes('/public/payment-links/')) {
        targetUrl = trimmed.endsWith('/spec') ? trimmed : `${trimmed}/spec`;
      } else if (parsed.pathname.includes('/pay/')) {
        const slug = parsed.pathname.split('/pay/')[1]?.split('/')[0]?.split('?')[0];
        if (this.apiUrl) {
          targetUrl = `${this.apiUrl}/api/v1/public/payment-links/${slug}/spec`;
        } else {
          targetUrl = `${parsed.origin}/pay/${slug}/spec`;
        }
      } else {
        targetUrl = trimmed;
      }
    } else {
      const cleanSlug = trimmed.split('?')[0].replace(/^\/+|\/+$/g, '');
      targetUrl = `${this.apiUrl}/api/v1/public/payment-links/${cleanSlug}/spec`;
    }

    const res = await globalThis.fetch(targetUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const parsed = new URL(trimmed);
        const slugMatch = parsed.pathname.match(/\/pay\/([^/?#]+)/);
        if (slugMatch && slugMatch[1]) {
          const altUrl = this.apiUrl && !trimmed.startsWith(this.apiUrl)
            ? `${this.apiUrl}/api/v1/public/payment-links/${slugMatch[1]}/spec`
            : `${parsed.origin}/pay/${slugMatch[1]}/spec`;
          if (altUrl !== targetUrl) {
            const fallbackRes = await globalThis.fetch(altUrl, {
              headers: { Accept: 'application/json' },
            });
            if (fallbackRes.ok) {
              const fallbackData = await fallbackRes.json();
              return (fallbackData.spec ?? fallbackData.paymentLink ?? fallbackData) as AgenticPaymentLinkSpec;
            }
          }
        }
      }
      const errText = await res.text().catch(() => '');
      throw new Error(`[ArcenPayAgent] Failed to resolve payment link (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    const spec = (data.spec ?? data.paymentLink ?? data) as AgenticPaymentLinkSpec;
    if (!spec || !spec.id || !spec.amount) {
      throw new Error(`[ArcenPayAgent] Invalid payment link specification received from ${targetUrl}`);
    }
    return spec;
  }

  /**
   * Discovers payment requirements, enforces spending limits, executes on-chain payment
   * (EVM transfer or Stellar SAC transfer), and confirms the checkout session.
   */
  async payPaymentLink(
    urlOrSlug: string,
    options?: PayPaymentLinkOptions,
  ): Promise<AgentPaymentReceipt> {
    // 1. Resolve specification
    const spec = await this.resolvePaymentLink(urlOrSlug);

    // 2. Validate status and expiration
    if (spec.status !== "ACTIVE") {
      throw new Error(`[ArcenPayAgent] Payment link is ${spec.status}, cannot execute payment.`);
    }
    if (spec.expiresAt && new Date(spec.expiresAt).getTime() <= Date.now()) {
      throw new Error(`[ArcenPayAgent] Payment link expired at ${spec.expiresAt}.`);
    }

    // 3. Verify Chain Compatibility
    if (spec.chainId !== this.config.chainId) {
      throw new Error(
        `[ArcenPayAgent] Chain mismatch: agent is configured for chain ${this.config.chainId} (${getChainDescriptor(this.config.chainId)?.name ?? "unknown"}), but payment link requires chain ${spec.chainId}.`,
      );
    }

    const requiredAmountAtomic = BigInt(spec.amountAtomic);
    const requiredAmountHuman = spec.amount;

    // 4. Budget & Limit Enforcement
    if (options?.maxPrice !== undefined) {
      const priceLimit = parsePriceLimit(options.maxPrice, "maxPrice");
      if (requiredAmountAtomic > priceLimit) {
        throw new Error(
          `[ArcenPayAgent] Payment amount ${formatUsdc(requiredAmountAtomic)} exceeds maxPrice limit of ${formatUsdc(priceLimit)}.`,
        );
      }
    }

    // Auto-approve check against maxAutoApprove
    if (options?.autoApprove !== false && this.config.maxAutoApprove) {
      const maxAutoApproveLimit = parseHumanUsdcAmount(this.config.maxAutoApprove, "maxAutoApprove");
      if (requiredAmountAtomic > maxAutoApproveLimit && options?.maxPrice === undefined) {
        throw new Error(
          `[ArcenPayAgent] Payment amount ${formatUsdc(requiredAmountAtomic)} exceeds agent maxAutoApprove limit of ${formatUsdc(maxAutoApproveLimit)}. To approve, pass options.maxPrice >= ${formatUsdc(requiredAmountAtomic)}.`,
        );
      }
    }

    // Daily spend check
    this.resetDailySpendIfNeeded();
    const dailyLimit = this.getDailySpendLimit();
    if (dailyLimit > 0n && this.dailySpent + requiredAmountAtomic > dailyLimit) {
      throw new Error(
        `[ArcenPayAgent] Daily spend limit reached: ${formatUsdc(this.dailySpent)} already spent, ${formatUsdc(requiredAmountAtomic)} needed, limit is ${formatUsdc(dailyLimit)}.`,
      );
    }

    const payerWallet = this.isStellar ? this.stellarAddress! : this.account.address;

    // 5. Create checkout session
    let sessionUrl = spec.sessionUrl;
    if (!sessionUrl.startsWith("http://") && !sessionUrl.startsWith("https://")) {
      sessionUrl = `${this.apiUrl}${sessionUrl.startsWith("/") ? "" : "/"}${sessionUrl}`;
    }

    const sessionRes = await globalThis.fetch(sessionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        customerWallet: payerWallet,
        customerName: options?.customerName ?? "AI Agent",
        customerEmail: options?.customerEmail,
        isAgentic: true,
      }),
    });

    if (!sessionRes.ok) {
      const errText = await sessionRes.text().catch(() => "");
      throw new Error(`[ArcenPayAgent] Failed to create checkout session (${sessionRes.status}): ${errText || sessionRes.statusText}`);
    }

    const sessionData = await sessionRes.json();
    const session = sessionData.checkoutSession ?? sessionData;
    const sessionId = session.id;
    const recipientWallet = session.recipientWallet ?? spec.recipientWallet;

    // 6. Execute On-Chain Transfer
    let txHash: string;

    if (this.isStellar) {
      txHash = await this.sendStellarSacTransfer(
        recipientWallet,
        requiredAmountHuman,
        spec.currency,
        spec.acceptedToken,
      );
    } else {
      const tokenAddress =
        getTokenAddress(this.config.chainId, spec.acceptedToken || spec.currency) ??
        spec.acceptedToken;

      if (!tokenAddress) {
        throw new Error(
          `[ArcenPayAgent] No token address found for ${spec.currency} on chain ${this.config.chainId}.`,
        );
      }

      if (!this.walletClient) {
        throw new Error("[ArcenPayAgent] Wallet client not initialized for EVM chain.");
      }

      txHash = await this.walletClient.writeContract({
        chain: this.chain,
        account: this.account,
        address: tokenAddress as `0x${string}`,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [recipientWallet as `0x${string}`, requiredAmountAtomic],
      } as any);

      if (this.publicClient) {
        await this.publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` }).catch((err) => {
          console.warn("[ArcenPayAgent] Transaction receipt wait warning (will proceed to confirm):", err);
        });
      }
    }

    // 7. Confirm checkout session
    const confirmTemplate =
      spec.confirmUrl || `${this.apiUrl}/api/v1/public/checkout/:sessionId/confirm`;
    let confirmUrl = confirmTemplate.replace(":sessionId", sessionId);
    if (!confirmUrl.startsWith("http://") && !confirmUrl.startsWith("https://")) {
      confirmUrl = `${this.apiUrl}${confirmUrl.startsWith("/") ? "" : "/"}${confirmUrl}`;
    }

    const confirmRes = await globalThis.fetch(confirmUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ txHash }),
    });

    if (!confirmRes.ok) {
      const errText = await confirmRes.text().catch(() => "");
      console.warn(`[ArcenPayAgent] Payment confirmation returned ${confirmRes.status}: ${errText}`);
    }

    // 8. Update spend accounting
    this.totalSpent += requiredAmountAtomic;
    this.dailySpent += requiredAmountAtomic;

    // 9. Return receipt
    const receipt: AgentPaymentReceipt = {
      success: true,
      sessionId,
      paymentLinkId: spec.id,
      paymentLinkSlug: spec.slug,
      txHash,
      amount: requiredAmountHuman,
      currency: spec.currency,
      chainId: spec.chainId,
      chainFamily: spec.chainFamily,
      payerWallet,
      recipientWallet,
      timestamp: new Date().toISOString(),
    };

    return receipt;
  }

  /**
   * Programmatically creates a new payment link (with isAgentic: true).
   * Enables agents to act as merchants selling data, model inferences, or services.
   */
  async createPaymentLink(params: CreateAgentPaymentLinkParams): Promise<AgenticPaymentLinkSpec> {
    const targetUrl = `${this.apiUrl}/api/v1/payment-links`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const recipientWallet =
      params.recipientWallet ??
      (this.isStellar ? this.stellarAddress! : this.account.address);

    const title = params.title ?? params.name ?? "Agent Payment Link";
    const acceptedToken = params.acceptedToken ?? params.currency ?? "USDC";

    const body = {
      title,
      name: title,
      description: params.description,
      amount: params.amount,
      currency: params.currency ?? "USDC",
      acceptedToken,
      chainId: params.chainId ?? this.config.chainId,
      recipientWallet,
      isAgentic: true,
      expiresInMinutes: params.expiresInMinutes,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      metadata: params.metadata,
    };

    const res = await globalThis.fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`[ArcenPayAgent] Failed to create payment link (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    return (data.spec ?? data.paymentLink ?? data) as AgenticPaymentLinkSpec;
  }

  // ─── ArcenAuth Mandate & Policy (Layers 2 & 3) ────────────

  setMandate(mandate: ArcenPayAgentMandate): void {
    this.mandate = mandate;
  }

  getMandate(): ArcenPayAgentMandate | null {
    return this.mandate;
  }

  addPolicy(policy: ArcenPolicy): void {
    this.policyEvaluator.addPolicy(policy);
  }

  setPolicies(policies: ArcenPolicy[]): void {
    this.policyEvaluator.setPolicies(policies);
  }

  getPolicies(): ArcenPolicy[] {
    return this.policyEvaluator.getPolicies();
  }

  checkPolicy(context: Partial<PolicyEvaluationContext>): PolicyEvaluationResult {
    const defaultTx = {
      amount: "0",
      amountAtomic: 0n,
      token: "USDC",
      recipient: this.address,
      chainId: this.config.chainId,
    };

    const fullContext: PolicyEvaluationContext = {
      tx: { ...defaultTx, ...(context.tx ?? {}) },
      resource: context.resource,
      agentId: context.agentId ?? this.address,
      mandateId: context.mandateId ?? this.mandate?.mandateId,
      coSigned: context.coSigned ?? false,
      dailySpent: Number(formatUnits(this.getDailySpent(), 6)),
      timestamp: Date.now(),
    };

    return this.policyEvaluator.evaluate(fullContext);
  }

  async issueSubMandate(params: {
    childAgentId: string;
    childPublicKey: string;
    childScope: MandateScope;
  }): Promise<ArcenPayAgentMandate> {
    if (!this.mandate) {
      throw new Error("[ArcenPayAgent] Cannot issue sub-mandate: parent agent has no active mandate.");
    }

    const subsetCheck = isScopeSubset(params.childScope, this.mandate.scope);
    if (!subsetCheck.valid) {
      throw new Error(`[ArcenPayAgent] Sub-mandate scope exceeds parent authority: ${subsetCheck.reason}`);
    }

    const unsigned = createAgentMandate({
      issuer: {
        kind: "parent_agent",
        address: this.address,
        chainId: this.config.chainId,
      },
      subject: {
        kind: "agent",
        agentId: params.childAgentId,
        publicKey: params.childPublicKey,
        parentMandateId: this.mandate.mandateId,
      },
      scope: params.childScope,
      revocation: this.mandate.revocation,
    });

    return signAgentMandate(unsigned, this.config.privateKey, this.config.chainId);
  }

  async issueMandate(params: {
    childAgentId: string;
    childPublicKey: string;
    childScope: MandateScope;
    isSubMandate?: boolean;
    revocationConfig?: MandateRevocationConfig;
  }): Promise<ArcenPayAgentMandate> {
    if (params.isSubMandate || (this.mandate && params.isSubMandate !== false)) {
      return this.issueSubMandate({
        childAgentId: params.childAgentId,
        childPublicKey: params.childPublicKey,
        childScope: params.childScope,
      });
    }

    const unsigned = createAgentMandate({
      issuer: {
        kind: "human_wallet",
        address: this.address,
        chainId: this.config.chainId,
      },
      subject: {
        kind: "agent",
        agentId: params.childAgentId,
        publicKey: params.childPublicKey,
      },
      scope: params.childScope,
      revocation: params.revocationConfig,
    });

    return signAgentMandate(unsigned, this.config.privateKey, this.config.chainId);
  }

  async revokeMandate(mandateId: string, reason?: string): Promise<{
    revoked: boolean;
    mandateId: string;
    reason: string;
    timestamp: string;
  }> {
    const timestamp = new Date().toISOString();
    const effectiveReason = reason ?? "Revoked by agent";
    if (this.mandate && this.mandate.mandateId === mandateId) {
      this.mandate = null;
    }

    if (this.apiUrl) {
      await globalThis.fetch(`${this.apiUrl}/api/v1/mandates/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandateId,
          reason: effectiveReason,
          revokedBy: this.address,
        }),
      }).catch((err) => {
        console.warn("[ArcenPayAgent] Mandate revocation broadcast warning:", err);
      });
    }

    return {
      revoked: true,
      mandateId,
      reason: effectiveReason,
      timestamp,
    };
  }

  async getMandateStatus(mandateId?: string): Promise<MandateStatus> {
    const targetId = mandateId ?? this.mandate?.mandateId;
    if (!targetId) {
      throw new Error("[ArcenPayAgent] No mandateId specified and agent has no active mandate.");
    }

    if (this.apiUrl) {
      try {
        const res = await globalThis.fetch(`${this.apiUrl}/api/v1/mandates/${encodeURIComponent(targetId)}/status`);
        if (res.ok) {
          const data = await res.json();
          return data as MandateStatus;
        }
      } catch {
        // Fallback to local evaluation if backend unreachable
      }
    }

    const isCurrent = this.mandate && this.mandate.mandateId === targetId;
    let status: "active" | "revoked" | "expired" = "active";
    if (isCurrent && this.mandate?.scope.validUntil && new Date(this.mandate.scope.validUntil).getTime() < Date.now()) {
      status = "expired";
    }

    return {
      mandateId: targetId,
      status,
      checkedAt: new Date().toISOString(),
    };
  }

  // ─── Verify-Then-Settle Escrow (Section 11) ─────────────────

  async fetchEscrowed(
    url: string,
    options: Omit<FetchOptions, "mode"> & {
      mode?: EscrowMode;
      escrowMode?: EscrowMode;
      schemaDescriptor?: Record<string, unknown>;
      onCommitmentReceived?: (commitment: ProviderCommitment) => void;
    } = {},
  ): Promise<{
    response: Response;
    payload: any;
    verified: boolean;
    commitment?: ProviderCommitment;
    disputeReceipt?: DisputeReceipt;
  }> {
    const { mode, escrowMode, schemaDescriptor, onCommitmentReceived, ...fetchOpts } = options;
    const res = await this.fetch(url, fetchOpts);
    const commitmentHeader = res.headers.get("x-arcen-commitment");
    const commitmentMode =
      (res.headers.get("x-arcen-commitment-mode") as EscrowMode) || escrowMode || mode || "exact_hash";
    const commitmentSig = res.headers.get("x-arcen-commitment-sig") || "0x_provider_sig";
    const nonceHeader = res.headers.get("x-arcen-request-nonce") || String(this.nonce);

    let payload: any;
    const cloned = res.clone();
    try {
      payload = await cloned.json();
    } catch {
      payload = await res.text();
    }

    if (!commitmentHeader) {
      return { response: res, payload, verified: true };
    }

    const commitment: ProviderCommitment = {
      type: "ArcenProviderCommitment",
      requestNonce: nonceHeader,
      resourceId: url,
      mode: commitmentMode,
      commitment: commitmentHeader,
      timestamp: new Date().toISOString(),
      providerSignature: commitmentSig,
    };

    this.pendingCommitments.set(nonceHeader, commitment);

    if (options.onCommitmentReceived) {
      options.onCommitmentReceived(commitment);
    }

    const verification = verifyCommitmentEngine(commitment, payload, options.schemaDescriptor);

    if (verification.valid) {
      await this.confirmSettlement(commitment.requestNonce).catch((err) => {
        console.warn("[ArcenPayAgent] Escrow confirmation warning:", err);
      });
      return { response: res, payload, verified: true, commitment };
    } else {
      const disputeReceipt = await this.disputeSettlement(commitment.requestNonce, {
        providerCommitment: commitment,
        actualPayloadHash: `sha256:${computeExactHash(payload)}`,
        failureReason: verification.failureReason ?? "hash_mismatch",
        schemaViolationDetail: verification.errorDetail,
      }).catch((err) => {
        console.warn("[ArcenPayAgent] Escrow dispute submission warning:", err);
        return undefined;
      });

      return {
        response: res,
        payload,
        verified: false,
        commitment,
        disputeReceipt,
      };
    }
  }

  verifyCommitment(
    commitment: ProviderCommitment,
    payload: unknown,
    schemaDescriptor?: Record<string, unknown>,
  ): { valid: boolean; failureReason?: DisputeReason; errorDetail?: string } {
    return verifyCommitmentEngine(commitment, payload, schemaDescriptor);
  }

  async confirmSettlement(requestNonce: string): Promise<SettlementConfirmation> {
    const confirmation: SettlementConfirmation = {
      type: "ArcenSettlementConfirmation",
      requestNonce,
      verifiedCommitment: `verified:${requestNonce}`,
      result: "match",
      agentSignature: "0x_confirmed",
    };

    if (this.apiUrl) {
      await globalThis.fetch(`${this.apiUrl}/api/v1/public/escrow/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(confirmation),
      }).catch(() => {});
    }

    return confirmation;
  }

  async disputeSettlement(
    requestNonce: string,
    claimDetails: Partial<DisputeClaim>,
  ): Promise<DisputeReceipt> {
    const claim: DisputeClaim = {
      type: "ArcenDisputeClaim",
      requestNonce,
      providerCommitment: claimDetails.providerCommitment!,
      actualPayloadHash: claimDetails.actualPayloadHash ?? "sha256:mismatch",
      failureReason: claimDetails.failureReason ?? "hash_mismatch",
      schemaViolationDetail: claimDetails.schemaViolationDetail,
      agentSignature: "0x_agent_dispute_sig",
    };

    let receipt: DisputeReceipt = {
      type: "ArcenDisputeReceipt",
      requestNonce,
      outcome: "refunded",
      reason: `Automated refund: ${claim.failureReason} confirmed`,
      resolvedAt: new Date().toISOString(),
    };

    if (this.apiUrl) {
      const res = await globalThis.fetch(`${this.apiUrl}/api/v1/public/escrow/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(claim),
      }).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        receipt = data.receipt ?? receipt;
      }
    }

    return receipt;
  }

  async getSettlementStatus(requestNonce: string): Promise<{
    requestNonce: string;
    status: EscrowReservationStatus;
    reservation?: EscrowReservation;
  }> {
    if (this.apiUrl) {
      try {
        const res = await globalThis.fetch(
          `${this.apiUrl}/api/v1/public/escrow/status?requestNonce=${encodeURIComponent(requestNonce)}`,
        );
        if (res.ok) {
          const data = await res.json();
          return {
            requestNonce,
            status: data.status ?? "reserved",
            reservation: data.reservation,
          };
        }
      } catch {
        // Fallback to local state
      }
    }

    const commitment = this.pendingCommitments.get(requestNonce);
    return {
      requestNonce,
      status: commitment ? "reserved" : "released",
    };
  }
}

/** @alias ArcenPayAgent, MEAPAgent — Aliases for ArcenAgent */
export { ArcenAgent as ArcenPayAgent, ArcenAgent as MEAPAgent };
