// ============================================================
//  AggregatorService — Unit Tests
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import { AggregatorService } from "../src/services/aggregator";

describe("AggregatorService", () => {
    let aggregator: AggregatorService;

    beforeEach(() => {
        aggregator = new AggregatorService({ settlementThreshold: 3 });
    });

    describe("addEntry", () => {
        it("should accumulate entries for a session", () => {
            const result = aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 200,
                signature: "sig1",
            });

            expect(result.totalEntries).toBe(1);
            expect(result.thresholdReached).toBe(false);
        });

        it("should report threshold reached when count meets limit", () => {
            for (let i = 0; i < 2; i++) {
                aggregator.addEntry({
                    sessionId: "session-1",
                    endpoint: "/api/data",
                    method: "GET",
                    timestamp: 1000 + i,
                    responseSize: 100,
                    signature: `sig${i}`,
                });
            }

            const result = aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 3000,
                responseSize: 100,
                signature: "sig3",
            });

            expect(result.totalEntries).toBe(3);
            expect(result.thresholdReached).toBe(true);
        });

        it("should track entries per session independently", () => {
            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 100,
                signature: "sig1",
            });

            const result = aggregator.addEntry({
                sessionId: "session-2",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 100,
                signature: "sig2",
            });

            expect(result.totalEntries).toBe(1);
        });
    });

    describe("buildMerkleTree", () => {
        it("should return zero hash for empty session", () => {
            const root = aggregator.buildMerkleTree("nonexistent");
            expect(root).toBe("0x" + "0".repeat(64));
        });

        it("should return a valid hash for a single entry", () => {
            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 100,
                signature: "sig1",
            });

            const root = aggregator.buildMerkleTree("session-1");
            expect(root).toMatch(/^0x[a-f0-9]{64}$/);
        });

        it("should produce deterministic Merkle roots", () => {
            for (let i = 0; i < 3; i++) {
                aggregator.addEntry({
                    sessionId: "session-1",
                    endpoint: "/api/data",
                    method: "GET",
                    timestamp: 1000 + i,
                    responseSize: 100,
                    signature: `sig${i}`,
                });
            }

            const root1 = aggregator.buildMerkleTree("session-1");
            const root2 = aggregator.buildMerkleTree("session-1");
            expect(root1).toBe(root2);
        });
    });

    describe("getCircuitInputs", () => {
        it("should return correct circuit inputs", () => {
            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 100,
                signature: "sig1",
            });

            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/other",
                method: "POST",
                timestamp: 2000,
                responseSize: 300,
                signature: "sig2",
            });

            const inputs = aggregator.getCircuitInputs("session-1");

            expect(inputs.callCount).toBe(2);
            expect(inputs.windowStart).toBe(1000);
            expect(inputs.windowEnd).toBe(2000);
            expect(inputs.merkleRoot).toMatch(/^0x[a-f0-9]{64}$/);
            expect(inputs.logHashes).toHaveLength(2);
        });

        it("should return empty inputs for unknown session", () => {
            const inputs = aggregator.getCircuitInputs("nonexistent");

            expect(inputs.callCount).toBe(0);
            expect(inputs.windowStart).toBe(0);
            expect(inputs.windowEnd).toBe(0);
        });
    });

    describe("clearSettledEntries", () => {
        it("should remove entries before the given windowEnd", () => {
            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 1000,
                responseSize: 100,
                signature: "sig1",
            });

            aggregator.addEntry({
                sessionId: "session-1",
                endpoint: "/api/data",
                method: "GET",
                timestamp: 3000,
                responseSize: 100,
                signature: "sig2",
            });

            aggregator.clearSettledEntries("session-1", 2000);

            const inputs = aggregator.getCircuitInputs("session-1");
            expect(inputs.callCount).toBe(1);
            expect(inputs.windowStart).toBe(3000);
        });
    });

    describe("getStats", () => {
        it("should return aggregation stats", () => {
            for (let i = 0; i < 3; i++) {
                aggregator.addEntry({
                    sessionId: "session-1",
                    endpoint: "/api/data",
                    method: "GET",
                    timestamp: 1000 + i,
                    responseSize: 100,
                    signature: `sig${i}`,
                });
            }

            const stats = aggregator.getStats();
            expect(stats.sessions).toBe(1);
            expect(stats.totalEntries).toBe(3);
            expect(stats.pendingSettlements).toBe(1); // threshold = 3, reached
        });
    });
});
