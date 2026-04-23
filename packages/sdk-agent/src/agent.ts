// ============================================================
//  @arcenpay/agent — AI Agent Client
//  Autonomous x402 payment negotiation with real viem signing
// ============================================================

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  parseUnits,
  type PublicClient,
  type WalletClient,
  type Chain,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, base } from 'viem/chains';
import type { X402Response, X402PaymentHeader } from '@arcenpay/sdk';
import { X402_VERSION, X402_SCHEME, SessionVaultABI, getContractAddresses, TOKENS } from '@arcenpay/sdk';

export interface AgentConfig {
  /** Agent's wallet private key (for signing payments) */
  privateKey: string;
  /** RPC URL for the target chain */
  rpcUrl: string;
  /** Chain ID */
  chainId: number;
  /** Maximum amount to auto-approve per request (in USDC, e.g., "0.01") */
  maxAutoApprove?: string;
  /** Session vault address (if pre-funded) */
  sessionVaultAddress?: string;
}

export interface FetchOptions extends RequestInit {
  /** Maximum price willing to pay (decimal USDC string like "0.01", or atomic units as bigint / integer string) */
  maxPrice?: string | bigint;
  /** Whether to auto-approve payment if within maxAutoApprove */
  autoApprove?: boolean;
}

// EIP-712 domain and types matching x402 middleware
const PAYMENT_DOMAIN_NAME = 'MEAP x402 Payment';
const PAYMENT_DOMAIN_VERSION = '1';

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

function parseHumanUsdcAmount(value: string, field: string): bigint {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`[MEAPAgent] ${field} must be a non-empty USDC amount`);
  }

  try {
    return parseUnits(trimmed, 6);
  } catch {
    throw new Error(
      `[MEAPAgent] ${field} must be a valid USDC amount like "0.01"`,
    );
  }
}

function parsePriceLimit(value: string | bigint, field: string): bigint {
  if (typeof value === 'bigint') return value;

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`[MEAPAgent] ${field} must be a non-empty price limit`);
  }

  if (trimmed.includes('.')) {
    return parseHumanUsdcAmount(trimmed, field);
  }

  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(
      `[MEAPAgent] ${field} must be a decimal USDC string like "0.01" or an atomic-unit bigint/integer string`,
    );
  }
}

/**
 * MEAPAgent — AI Agent SDK for autonomous x402 payments
 *
 * Drop-in replacement for fetch() that handles x402 payment negotiation automatically.
 * Uses real viem signing and on-chain SessionVault interactions.
 *
 * @example
 * ```ts
 * import { MEAPAgent } from '@arcenpay/agent';
 *
 * const agent = new MEAPAgent({
 *   privateKey: process.env.AGENT_PRIVATE_KEY!,
 *   rpcUrl: 'https://sepolia.base.org',
 *   chainId: 84532,
 *   maxAutoApprove: '0.01',
 * });
 *
 * // Fund a session
 * await agent.fundSession('10');
 *
 * // Use like fetch() — x402 payments are handled automatically
 * const response = await agent.fetch('https://api.example.com/premium/data');
 * const data = await response.json();
 * ```
 */
export class MEAPAgent {
  private config: AgentConfig;
  private sessionId: string | null = null;
  private totalSpent: bigint = 0n;
  private nonce: bigint = 0n;
  private publicClient: PublicClient;
  private walletClient: WalletClient;
  private account: ReturnType<typeof privateKeyToAccount>;
  private contracts: ReturnType<typeof getContractAddresses>;
  private chain: Chain;

  constructor(config: AgentConfig) {
    this.config = {
      maxAutoApprove: '0.01',
      ...config,
    };

    this.chain = CHAIN_MAP[config.chainId] || sepolia;
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`);
    const resolvedContracts = getContractAddresses(config.chainId);
    this.contracts = config.sessionVaultAddress
      ? {
          ...resolvedContracts,
          sessionVault: config.sessionVaultAddress,
        }
      : resolvedContracts;

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

  /**
   * Returns the agent's wallet address
   */
  get address(): string {
    return this.account.address;
  }

  /**
   * Pre-funds a ZKVUB session vault with USDC
   *
   * Steps:
   * 1. Approve SessionVault to spend `amount` of USDC
   * 2. Call SessionVault.fundSession(amount, token)
   * 3. Store returned sessionId
   *
   * @param amount Amount to deposit (human-readable, e.g., "10" = 10 USDC)
   * @returns Session ID (bytes32 hex)
   */
  async fundSession(amount: string): Promise<string> {
    const amountAtomic = parseHumanUsdcAmount(amount, 'amount');
    const usdcAddress = TOKENS[this.config.chainId as keyof typeof TOKENS]?.USDC as `0x${string}`;
    const vaultAddress = this.contracts.sessionVault as `0x${string}`;

    if (!usdcAddress) {
      throw new Error(`No USDC address configured for chain ${this.config.chainId}`);
    }

    // Step 1: Approve SessionVault to spend USDC
    const approveHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: usdcAddress,
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [vaultAddress, amountAtomic],
    } as any);

    console.log(`[MEAPAgent] USDC approve tx: ${approveHash}`);
    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });

    // Step 2: Call SessionVault.fundSession()
    const fundHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.account,
      address: vaultAddress,
      abi: SessionVaultABI,
      functionName: 'fundSession',
      args: [amountAtomic, usdcAddress],
    } as any);

    console.log(`[MEAPAgent] Fund session tx: ${fundHash}`);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: fundHash });

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
        '[MEAPAgent] fundSession() succeeded on-chain but SessionFunded event could not be decoded',
      );
    }

    this.sessionId = sessionId;

    console.log(`[MEAPAgent] Session funded: ${amount} USDC → ${this.sessionId}`);
    return this.sessionId;
  }

  /**
   * Drop-in replacement for fetch() with automatic x402 payment negotiation
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
    console.log(`[MEAPAgent] Received 402: ${x402Response.error}`);

    // Step 4: Evaluate payment options
    const paymentOption = x402Response.accepts[0];
    if (!paymentOption) {
      throw new Error('No payment options available');
    }

    const requiredAmount = BigInt(paymentOption.maxAmountRequired);
    const maxAutoApproveAmount = parseHumanUsdcAmount(
      this.config.maxAutoApprove || '0',
      'maxAutoApprove',
    );

    // Step 5: Auto-approve check
    if (autoApprove && requiredAmount > maxAutoApproveAmount) {
      throw new Error(
        `Payment amount ${requiredAmount} exceeds auto-approve limit ${maxAutoApproveAmount}`,
      );
    }

    if (maxPrice !== undefined && requiredAmount > parsePriceLimit(maxPrice, 'maxPrice')) {
      throw new Error(
        `Payment amount ${requiredAmount} exceeds max price ${maxPrice}`,
      );
    }

    // Step 6: Construct and sign payment with EIP-712
    const paymentNonce = this.nonce;
    const paymentHeader = await this.constructPayment(paymentOption);
    this.nonce += 1n;

    // Step 7: Check balance before attempting payment
    const balance = await this.getBalance();
    if (balance < requiredAmount) {
      throw new Error(
        `[MEAPAgent] Insufficient session balance: have ${balance}, need ${requiredAmount}. ` +
        `Call fundSession() to top up before retrying.`,
      );
    }

    // Step 8: Resubmit request with X-PAYMENT header
    const paidResponse = await globalThis.fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'X-PAYMENT': paymentHeader,
      },
    });

    // Nonces are single-use. Once we attempt a paid request, the next attempt must use a fresh nonce.
    if (paidResponse.ok) {
      this.totalSpent += requiredAmount;
      console.log(
        `[MEAPAgent] Payment settled with nonce ${paymentNonce}. Total spent: ${this.totalSpent}, next nonce: ${this.nonce}`,
      );
    } else {
      console.warn(
        `[MEAPAgent] Paid request returned non-2xx (${paidResponse.status}). ` +
        `A fresh nonce will be used on the next attempt.`,
      );
    }

    return paidResponse;
  }

  /**
   * Returns current session vault balance from on-chain
   */
  async getBalance(): Promise<bigint> {
    try {
      const balance = await this.publicClient.readContract({
        address: this.contracts.sessionVault as `0x${string}`,
        abi: SessionVaultABI,
        functionName: 'getAgentBalance',
        args: [this.account.address],
      });
      return balance as bigint;
    } catch (err) {
      console.error('[MEAPAgent] Balance query failed:', err);
      return 0n;
    }
  }

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
      sessionId: sessionId || this.sessionId || 'none',
      callCount: Number(this.nonce),
      totalSpent: this.totalSpent,
      remainingBalance: balance,
    };
  }

  /**
   * Constructs a signed X-PAYMENT header using EIP-712 typed data
   */
  private async constructPayment(option: X402Response['accepts'][0]): Promise<string> {
    const timestamp = BigInt(Date.now());

    const message = {
      from: this.account.address,
      amount: BigInt(option.maxAmountRequired),
      resource: option.resource,
      sessionId: this.sessionId || '',
      nonce: this.nonce,
      timestamp,
    };

    // Sign EIP-712 typed data
    const signature = await this.walletClient.signTypedData({
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

/** @alias MEAPAgent — ArcenPay-branded alias */
export { MEAPAgent as ArcenPayAgent };
