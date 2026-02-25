// ============================================================
//  @meap/agent — AI Agent Client
//  Autonomous x402 payment negotiation for AI agents
// ============================================================

import type { X402Response, X402PaymentHeader, SessionVaultInfo } from '@meap/core';
import { X402_VERSION, X402_SCHEME } from '@meap/core';

interface AgentConfig {
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

interface FetchOptions extends RequestInit {
  /** Maximum price willing to pay (in USDC atomic units) */
  maxPrice?: string;
  /** Whether to auto-approve payment if within maxAutoApprove */
  autoApprove?: boolean;
}

/**
 * MEAPAgent — AI Agent SDK for autonomous x402 payments
 *
 * Drop-in replacement for fetch() that handles x402 payment negotiation automatically.
 * Designed for embedding in agent frameworks (LangChain, AutoGen, custom runtimes).
 *
 * @example
 * ```ts
 * import { MEAPAgent } from '@meap/agent';
 *
 * const agent = new MEAPAgent({
 *   privateKey: process.env.AGENT_PRIVATE_KEY!,
 *   rpcUrl: 'https://sepolia.base.org',
 *   chainId: 84532,
 *   maxAutoApprove: '0.01',
 * });
 *
 * // Fund a session
 * await agent.fundSession('10', '0xUSDC_ADDRESS');
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

  constructor(config: AgentConfig) {
    this.config = {
      maxAutoApprove: '0.01',
      ...config,
    };
  }

  /**
   * Pre-funds a ZKVUB session vault with stablecoins
   * @param amount Amount to deposit (human-readable, e.g., "10" = 10 USDC)
   * @param token Stablecoin address
   */
  async fundSession(amount: string, token: string): Promise<string> {
    // TODO: Implement via viem:
    // 1. Approve SessionVault to spend `amount` of `token`
    // 2. Call SessionVault.fundSession(amount, token)
    // 3. Store returned sessionId

    this.sessionId = `session_${Date.now()}`;
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
      return response; // No payment needed
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
    const maxAutoApproveAmount = BigInt(
      Math.floor(parseFloat(this.config.maxAutoApprove || '0') * 1_000_000),
    );

    // Step 5: Auto-approve check
    if (autoApprove && requiredAmount > maxAutoApproveAmount) {
      throw new Error(
        `Payment amount ${requiredAmount} exceeds auto-approve limit ${maxAutoApproveAmount}`,
      );
    }

    if (maxPrice && requiredAmount > BigInt(maxPrice)) {
      throw new Error(
        `Payment amount ${requiredAmount} exceeds max price ${maxPrice}`,
      );
    }

    // Step 6: Construct and sign payment
    const paymentHeader = await this.constructPayment(paymentOption);

    // Step 7: Resubmit request with X-PAYMENT header
    const paidResponse = await globalThis.fetch(url, {
      ...fetchOptions,
      headers: {
        ...fetchOptions.headers,
        'X-PAYMENT': paymentHeader,
      },
    });

    this.totalSpent += requiredAmount;
    console.log(`[MEAPAgent] Payment successful. Total spent: ${this.totalSpent}`);

    return paidResponse;
  }

  /**
   * Returns current session vault balance
   */
  async getBalance(): Promise<bigint> {
    // TODO: Query SessionVault.getAgentBalance() via viem
    return 0n;
  }

  /**
   * Returns aggregated consumption data for a session
   */
  async getUsageReport(sessionId?: string): Promise<{
    sessionId: string;
    callCount: number;
    totalSpent: bigint;
  }> {
    return {
      sessionId: sessionId || this.sessionId || 'none',
      callCount: 0,
      totalSpent: this.totalSpent,
    };
  }

  /**
   * Constructs a signed X-PAYMENT header
   */
  private async constructPayment(option: X402Response['accepts'][0]): Promise<string> {
    // TODO: Implement full x402 payment construction:
    // 1. Create payment payload with amount, recipient, nonce
    // 2. Sign with agent's private key via viem
    // 3. Base64 encode the signed payload
    // 4. Return as X-PAYMENT header value

    const payload: X402PaymentHeader = {
      version: X402_VERSION,
      scheme: option.scheme,
      network: option.network,
      payload: JSON.stringify({
        amount: option.maxAmountRequired,
        payTo: option.payTo,
        resource: option.resource,
        timestamp: Date.now(),
        sessionId: this.sessionId,
      }),
      signature: '0x0', // TODO: Sign with viem
    };

    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
}
