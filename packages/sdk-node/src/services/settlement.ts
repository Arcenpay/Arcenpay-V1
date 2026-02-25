// ============================================================
//  @meap/node — Settlement Watcher & Session Balance Service
//  PRD Section 5.2.3: Settlement monitoring and vault queries
// ============================================================

import type { BillingSettlement } from '@meap/core';

type SettlementCallback = (settlement: BillingSettlement) => void;

/**
 * SettlementService — Monitors on-chain BillingSettled events
 * and provides session vault balance queries
 */
export class SettlementService {
  private rpcUrl: string;
  private zkVerifierAddress: string;
  private sessionVaultAddress: string;
  private watchers: SettlementCallback[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: {
    rpcUrl: string;
    zkVerifierAddress: string;
    sessionVaultAddress: string;
  }) {
    this.rpcUrl = config.rpcUrl;
    this.zkVerifierAddress = config.zkVerifierAddress;
    this.sessionVaultAddress = config.sessionVaultAddress;
  }

  /**
   * Queries the SessionVault for remaining balance
   * PRD: meap.getSessionBalance(agentAddress)
   */
  async getSessionBalance(agentAddress: string): Promise<bigint> {
    // TODO: Implement via viem public client
    // 1. Create public client with the configured RPC URL
    // 2. Call SessionVault.getAgentBalance(agentAddress)
    // 3. Return the balance as bigint
    //
    // const client = createPublicClient({ transport: http(this.rpcUrl) });
    // return await client.readContract({
    //   address: this.sessionVaultAddress as `0x${string}`,
    //   abi: sessionVaultAbi,
    //   functionName: 'getAgentBalance',
    //   args: [agentAddress],
    // });

    console.log(`[SettlementService] Querying balance for ${agentAddress}`);
    return 0n; // Placeholder until viem integration
  }

  /**
   * Subscribes to on-chain BillingSettled events
   * PRD: meap.watchSettlements(callback)
   */
  watchSettlements(callback: SettlementCallback, intervalMs = 10000): () => void {
    this.watchers.push(callback);

    // Start polling if not already running
    if (!this.pollInterval) {
      this.pollInterval = setInterval(async () => {
        await this.pollSettlements();
      }, intervalMs);
    }

    // Return unsubscribe function
    return () => {
      this.watchers = this.watchers.filter((w) => w !== callback);
      if (this.watchers.length === 0 && this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
    };
  }

  /**
   * Polls for new BillingSettled events
   */
  private async pollSettlements(): Promise<void> {
    // TODO: Implement via viem
    // 1. Create public client
    // 2. Query BillingSettled events from ZKUsageVerifier since last block
    // 3. Parse events and notify all watchers
    //
    // const logs = await client.getLogs({
    //   address: this.zkVerifierAddress as `0x${string}`,
    //   event: parseAbiItem('event BillingSettled(bytes32 sessionId, ...)'),
    //   fromBlock: this.lastBlock,
    // });
    // logs.forEach(log => {
    //   const settlement = parseSettlement(log);
    //   this.watchers.forEach(cb => cb(settlement));
    // });
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
