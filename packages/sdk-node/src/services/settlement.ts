// ============================================================
//  @arcenpay/node — Settlement Watcher & Session Balance Service
//  Real viem integration for on-chain reads and event watching
// ============================================================

import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia, base } from 'viem/chains';
import type { BillingSettlement } from '@arcenpay/sdk';
import { SessionVaultABI, ZKUsageVerifierABI, getContractAddresses } from '@arcenpay/sdk';

type SettlementCallback = (settlement: BillingSettlement) => void;

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

/**
 * SettlementService — Monitors on-chain BillingSettled events
 * and provides session vault balance queries via viem
 */
export class SettlementService {
  private rpcUrl: string;
  private chainId: number;
  private zkVerifierAddress: string;
  private sessionVaultAddress: string;
  private watchers: SettlementCallback[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastBlock: bigint = 0n;
  private publicClient: any;

  constructor(config: {
    rpcUrl: string;
    chainId?: number;
    zkVerifierAddress?: string;
    sessionVaultAddress?: string;
  }) {
    this.rpcUrl = config.rpcUrl;
    this.chainId = config.chainId || 11155111;

    const contracts = getContractAddresses(this.chainId);
    this.zkVerifierAddress = config.zkVerifierAddress || contracts.zkUsageVerifier;
    this.sessionVaultAddress = config.sessionVaultAddress || contracts.sessionVault;

    const chain = CHAIN_MAP[this.chainId] || sepolia;
    this.publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    }) as any;
  }

  /**
   * Queries the SessionVault for remaining balance
   */
  async getSessionBalance(agentAddress: string): Promise<bigint> {
    try {
      const balance = await this.publicClient.readContract({
        address: this.sessionVaultAddress as `0x${string}`,
        abi: SessionVaultABI,
        functionName: 'getAgentBalance',
        args: [agentAddress as `0x${string}`],
      });
      return balance as bigint;
    } catch (err) {
      console.error('[SettlementService] Balance query failed:', err);
      return 0n;
    }
  }

  /**
   * Gets details for a specific session
   */
  async getSessionDetails(sessionId: string): Promise<any> {
    try {
      const session = await this.publicClient.readContract({
        address: this.sessionVaultAddress as `0x${string}`,
        abi: SessionVaultABI,
        functionName: 'getSession',
        args: [sessionId as `0x${string}`],
      });
      return session;
    } catch (err) {
      console.error('[SettlementService] Session query failed:', err);
      return null;
    }
  }

  /**
   * Subscribes to on-chain BillingSettled events
   */
  watchSettlements(callback: SettlementCallback, intervalMs = 10000): () => void {
    this.watchers.push(callback);

    if (!this.pollInterval) {
      this.initBlockNumber().then(() => {
        this.pollInterval = setInterval(async () => {
          await this.pollSettlements();
        }, intervalMs);
      });
    }

    return () => {
      this.watchers = this.watchers.filter((w) => w !== callback);
      if (this.watchers.length === 0 && this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
    };
  }

  /**
   * Initialize the starting block number for event polling
   */
  private async initBlockNumber(): Promise<void> {
    try {
      this.lastBlock = await this.publicClient.getBlockNumber();
    } catch {
      this.lastBlock = 0n;
    }
  }

  /**
   * Polls for new BillingSettled events from ZKUsageVerifier
   */
  private async pollSettlements(): Promise<void> {
    try {
      const currentBlock = await this.publicClient.getBlockNumber();
      if (currentBlock <= this.lastBlock) return;

      const logs = await this.publicClient.getLogs({
        address: this.zkVerifierAddress as `0x${string}`,
        event: {
          type: 'event',
          name: 'BillingSettled',
          inputs: [
            { name: 'sessionId', type: 'bytes32', indexed: true },
            { name: 'agentAddress', type: 'bytes32', indexed: true },
            { name: 'callCount', type: 'uint256', indexed: false },
            { name: 'settlementAmount', type: 'uint256', indexed: false },
            { name: 'windowStart', type: 'uint64', indexed: false },
            { name: 'windowEnd', type: 'uint64', indexed: false },
          ],
        },
        fromBlock: this.lastBlock + 1n,
        toBlock: currentBlock,
      });

      for (const log of logs) {
        const settlement: BillingSettlement = {
          sessionId: log.args.sessionId as string,
          agentAddress: log.args.agentAddress as string,
          callCount: log.args.callCount as bigint,
          settlementAmount: log.args.settlementAmount as bigint,
          windowStart: log.args.windowStart as bigint,
          windowEnd: log.args.windowEnd as bigint,
          transactionHash: log.transactionHash,
        };

        this.watchers.forEach((cb) => cb(settlement));
      }

      this.lastBlock = currentBlock;
    } catch (err) {
      console.error('[SettlementService] Polling error:', err);
    }
  }

  /**
   * Stops all settlement watchers
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.watchers = [];
  }
}
