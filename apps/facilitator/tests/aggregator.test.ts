import test from "node:test";
import assert from "node:assert/strict";
import { AggregatorService } from "../src/services/aggregator.js";

test("AggregatorService tracks threshold and produces deterministic circuit inputs", () => {
  const aggregator = new AggregatorService({ settlementThreshold: 2 });

  const first = aggregator.addEntry({
    sessionId: "session-alpha",
    endpoint: "/api/premium/data",
    method: "GET",
    timestamp: 1_700_000_000,
    responseSize: 42,
    signature: "sig-1",
  });
  const second = aggregator.addEntry({
    sessionId: "session-alpha",
    endpoint: "/api/premium/data",
    method: "POST",
    timestamp: 1_700_000_005,
    responseSize: 21,
    signature: "sig-2",
  });

  assert.deepEqual(first, {
    totalEntries: 1,
    thresholdReached: false,
  });
  assert.deepEqual(second, {
    totalEntries: 2,
    thresholdReached: true,
  });

  const inputs = aggregator.getCircuitInputs("session-alpha");
  assert.equal(inputs.callCount, 2);
  assert.equal(inputs.windowStart, 1_700_000_000);
  assert.equal(inputs.windowEnd, 1_700_000_005);
  assert.match(inputs.merkleRoot, /^0x[a-f0-9]{64}$/);
  assert.equal(inputs.logHashes.length, 2);
});

test("AggregatorService clears settled entries and resets pending state", () => {
  const aggregator = new AggregatorService({ settlementThreshold: 2 });

  aggregator.addEntry({
    sessionId: "session-beta",
    endpoint: "/v1/a",
    method: "GET",
    timestamp: 10,
    responseSize: 1,
    signature: "a",
  });
  aggregator.addEntry({
    sessionId: "session-beta",
    endpoint: "/v1/b",
    method: "GET",
    timestamp: 20,
    responseSize: 1,
    signature: "b",
  });
  aggregator.addEntry({
    sessionId: "session-beta",
    endpoint: "/v1/c",
    method: "GET",
    timestamp: 30,
    responseSize: 1,
    signature: "c",
  });

  aggregator.clearSettledEntries("session-beta", 20);

  const inputs = aggregator.getCircuitInputs("session-beta");
  assert.equal(inputs.callCount, 1);
  assert.equal(inputs.windowStart, 30);
  assert.equal(inputs.windowEnd, 30);

  const stats = aggregator.getStats();
  assert.equal(stats.sessions, 1);
  assert.equal(stats.totalEntries, 1);
  assert.equal(stats.pendingSettlements, 0);
});
