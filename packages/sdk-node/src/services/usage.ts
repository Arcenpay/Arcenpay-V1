// ============================================================
//  @meap/node — Usage Logging & Proof Generation Service
// ============================================================

import type { PublicInputs, UsageProof, BillingSettlement } from '@meap/core';

interface UsageLogEntry {
  sessionId: string;
  callData: {
    endpoint: string;
    method: string;
    timestamp: number;
    responseSize?: number;
  };
  signature?: string;
}

interface UsageAggregation {
  sessionId: string;
  callCount: number;
  windowStart: number;
  windowEnd: number;
  logs: UsageLogEntry[];
}

/**
 * Usage logging and proof generation service
 * Used by the Facilitator Node to track API consumption and generate zk-SNARK proofs
 */
export class UsageService {
  private logs: Map<string, UsageLogEntry[]> = new Map();

  /**
   * Records a signed consumption event to the off-chain aggregator
   */
  async logUsage(sessionId: string, callData: UsageLogEntry['callData']): Promise<void> {
    const entry: UsageLogEntry = {
      sessionId,
      callData,
      signature: '', // TODO: Sign with Facilitator Node key
    };

    const existing = this.logs.get(sessionId) || [];
    existing.push(entry);
    this.logs.set(sessionId, existing);
  }

  /**
   * Gets the current usage count for a session
   */
  getUsageCount(sessionId: string): number {
    return (this.logs.get(sessionId) || []).length;
  }

  /**
   * Aggregates usage logs for a billing window
   */
  aggregateUsage(sessionId: string, windowEnd: number): UsageAggregation {
    const logs = this.logs.get(sessionId) || [];
    const windowLogs = logs.filter((l) => l.callData.timestamp <= windowEnd);

    const windowStart = windowLogs.length > 0
      ? Math.min(...windowLogs.map((l) => l.callData.timestamp))
      : 0;

    return {
      sessionId,
      callCount: windowLogs.length,
      windowStart,
      windowEnd,
      logs: windowLogs,
    };
  }

  /**
   * Triggers zk-SNARK generation for a billing window
   * TODO: Integrate with Circom/snarkjs proof generation pipeline
   */
  async generateProof(
    sessionId: string,
    windowEnd: number,
  ): Promise<{ proof: UsageProof; publicInputs: PublicInputs }> {
    const aggregation = this.aggregateUsage(sessionId, windowEnd);

    // TODO: Generate actual Groth16 proof via snarkjs
    // 1. Build Merkle tree of signed consumption log hashes
    // 2. Construct circuit inputs
    // 3. Generate witness
    // 4. Run Groth16 prover
    // 5. Return proof + public inputs

    const proof: UsageProof = {
      a: [0n, 0n],
      b: [[0n, 0n], [0n, 0n]],
      c: [0n, 0n],
    };

    const publicInputs: PublicInputs = {
      agentAddress: '0x' + '0'.repeat(64),
      sessionId,
      callCount: BigInt(aggregation.callCount),
      windowStart: BigInt(aggregation.windowStart),
      windowEnd: BigInt(aggregation.windowEnd),
      merkleRoot: '0x' + '0'.repeat(64),
      nullifier: '0x' + '0'.repeat(64),
    };

    return { proof, publicInputs };
  }

  /**
   * Submits generated proof to ZKUsageVerifier.sol for settlement
   * TODO: Integrate with viem for on-chain transaction
   */
  async submitProof(
    proof: UsageProof,
    publicInputs: PublicInputs,
  ): Promise<BillingSettlement> {
    // TODO: Submit to ZKUsageVerifier.sol via viem
    return {
      sessionId: publicInputs.sessionId,
      agentAddress: publicInputs.agentAddress,
      callCount: publicInputs.callCount,
      settlementAmount: 0n,
      windowStart: publicInputs.windowStart,
      windowEnd: publicInputs.windowEnd,
      transactionHash: '0x0',
    };
  }

  /**
   * Clears logs for a settled session window
   */
  clearLogs(sessionId: string, windowEnd: number): void {
    const logs = this.logs.get(sessionId) || [];
    this.logs.set(
      sessionId,
      logs.filter((l) => l.callData.timestamp > windowEnd),
    );
  }
}
