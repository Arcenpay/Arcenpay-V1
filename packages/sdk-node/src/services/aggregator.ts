// ============================================================
//  @arcenpay/node — Off-Chain Usage Aggregator
//  Merkle tree-based usage log accumulation for zk-SNARK proving
//  PRD §7.2 — Off-Chain Aggregation Service
// ============================================================

import { createHash } from 'crypto';

interface UsageEntry {
    sessionId: string;
    endpoint: string;
    method: string;
    timestamp: number;
    responseSize: number;
    signature: string;
}

interface MerkleNode {
    hash: string;
    left?: MerkleNode;
    right?: MerkleNode;
}

/**
 * AggregatorService — Accumulates signed usage logs into a Merkle tree
 * and triggers zk-SNARK proof generation when the threshold is reached.
 *
 * Architecture:
 *   1. Facilitator logs each x402 API call to the aggregator
 *   2. Aggregator builds a Merkle tree of log hashes
 *   3. When threshold is reached, the proving pipeline is triggered
 *   4. The proof + Merkle root are submitted to ZKUsageVerifier.sol
 *
 * For production: replace in-memory maps with Redis for persistence
 * PRD §7.2 — ZKVUB Off-Chain Aggregation
 */
export class AggregatorService {
    private logs: Map<string, UsageEntry[]> = new Map();
    private merkleRoots: Map<string, string> = new Map();
    private settlementThreshold: number;

    constructor(config?: { settlementThreshold?: number }) {
        this.settlementThreshold = config?.settlementThreshold || 100;
    }

    /**
     * Append a signed usage entry
     */
    addEntry(entry: UsageEntry): { totalEntries: number; thresholdReached: boolean } {
        const existing = this.logs.get(entry.sessionId) || [];
        existing.push(entry);
        this.logs.set(entry.sessionId, existing);

        const thresholdReached = existing.length >= this.settlementThreshold;

        if (thresholdReached) {
            console.log(`[Aggregator] Threshold reached for session ${entry.sessionId} (${existing.length} entries)`);
        }

        return { totalEntries: existing.length, thresholdReached };
    }

    /**
     * Build a Merkle tree from session's usage logs
     * Returns the Merkle root hash
     */
    buildMerkleTree(sessionId: string): string {
        const entries = this.logs.get(sessionId) || [];
        if (entries.length === 0) return '0x' + '0'.repeat(64);

        // Hash each entry
        const leaves = entries.map((entry) =>
            this.hashEntry(entry)
        );

        // Build tree bottom-up
        const root = this.computeMerkleRoot(leaves);
        this.merkleRoots.set(sessionId, root);

        console.log(`[Aggregator] Merkle root for ${sessionId}: ${root} (${entries.length} leaves)`);
        return root;
    }

    /**
     * Get circuit inputs for zk-SNARK proving
     * These inputs are passed to the Circom circuit
     */
    getCircuitInputs(sessionId: string): {
        callCount: number;
        merkleRoot: string;
        windowStart: number;
        windowEnd: number;
        logHashes: string[];
    } {
        const entries = this.logs.get(sessionId) || [];
        const merkleRoot = this.merkleRoots.get(sessionId) || this.buildMerkleTree(sessionId);

        const timestamps = entries.map((e) => e.timestamp);
        const windowStart = timestamps.length > 0 ? Math.min(...timestamps) : 0;
        const windowEnd = timestamps.length > 0 ? Math.max(...timestamps) : 0;

        return {
            callCount: entries.length,
            merkleRoot,
            windowStart,
            windowEnd,
            logHashes: entries.map((e) => this.hashEntry(e)),
        };
    }

    /**
     * Clear entries for a settled session window
     */
    clearSettledEntries(sessionId: string, windowEnd: number): void {
        const entries = this.logs.get(sessionId) || [];
        this.logs.set(
            sessionId,
            entries.filter((e) => e.timestamp > windowEnd),
        );
        this.merkleRoots.delete(sessionId);

        console.log(`[Aggregator] Cleared entries for ${sessionId} before ${windowEnd}`);
    }

    /**
     * Get aggregation stats for monitoring
     */
    getStats(): { sessions: number; totalEntries: number; pendingSettlements: number } {
        let totalEntries = 0;
        let pendingSettlements = 0;

        for (const [, entries] of this.logs) {
            totalEntries += entries.length;
            if (entries.length >= this.settlementThreshold) {
                pendingSettlements++;
            }
        }

        return {
            sessions: this.logs.size,
            totalEntries,
            pendingSettlements,
        };
    }

    /**
     * Hash a single usage entry (leaf in the Merkle tree)
     */
    private hashEntry(entry: UsageEntry): string {
        const data = `${entry.sessionId}|${entry.endpoint}|${entry.method}|${entry.timestamp}|${entry.responseSize}|${entry.signature}`;
        return '0x' + createHash('sha256').update(data).digest('hex');
    }

    /**
     * Compute Merkle root from leaf hashes
     */
    private computeMerkleRoot(leaves: string[]): string {
        if (leaves.length === 0) return '0x' + '0'.repeat(64);
        if (leaves.length === 1) return leaves[0];

        // Pad to power of 2
        while (leaves.length & (leaves.length - 1)) {
            leaves.push('0x' + '0'.repeat(64));
        }

        let currentLevel = leaves;
        while (currentLevel.length > 1) {
            const nextLevel: string[] = [];
            for (let i = 0; i < currentLevel.length; i += 2) {
                const combined = currentLevel[i] + currentLevel[i + 1].slice(2);
                nextLevel.push('0x' + createHash('sha256').update(combined).digest('hex'));
            }
            currentLevel = nextLevel;
        }

        return currentLevel[0];
    }
}
