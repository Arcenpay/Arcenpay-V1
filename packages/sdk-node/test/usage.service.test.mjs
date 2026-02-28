import test from 'node:test';
import assert from 'node:assert/strict';

import { UsageService } from '../src/services/usage.ts';

const ZERO_ROOT = `0x${'0'.repeat(64)}`;
const DEFAULT_AGENT = `0x${'1'.repeat(40)}`;

test('logUsage signs entries and aggregateUsage includes signed logs', async () => {
  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
  });

  await usage.logUsage('session-1', {
    endpoint: '/api/premium/data',
    method: 'GET',
    timestamp: 1_700_000_000_000,
  });
  await usage.logUsage('session-1', {
    endpoint: '/api/premium/data',
    method: 'GET',
    timestamp: 1_700_000_001_000,
    responseSize: 128,
  });

  assert.equal(usage.getUsageCount('session-1'), 2);

  const aggregation = usage.aggregateUsage('session-1', 1_700_000_002_000);
  assert.equal(aggregation.callCount, 2);
  assert.match(aggregation.logs[0].signature, /^0x[a-f0-9]{64}$/);
  assert.match(aggregation.logs[1].signature, /^0x[a-f0-9]{64}$/);
  assert.notEqual(aggregation.logs[0].signature, aggregation.logs[1].signature);
});

test('generateProof derives deterministic public inputs and placeholder proof', async () => {
  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
  });

  await usage.logUsage('session-2', {
    endpoint: '/v1/data',
    method: 'POST',
    timestamp: 1_700_000_010_000,
  });
  await usage.logUsage('session-2', {
    endpoint: '/v1/data',
    method: 'POST',
    timestamp: 1_700_000_020_000,
  });

  const first = await usage.generateProof('session-2', 1_700_000_030_000);
  const second = await usage.generateProof('session-2', 1_700_000_030_000);

  assert.deepEqual(first, second);
  assert.equal(first.publicInputs.agentAddress, DEFAULT_AGENT);
  assert.equal(first.publicInputs.callCount, 2n);
  assert.equal(first.publicInputs.windowStart, 1_700_000_010_000n);
  assert.equal(first.publicInputs.windowEnd, 1_700_000_030_000n);
  assert.notEqual(first.publicInputs.merkleRoot, ZERO_ROOT);
  assert.match(first.publicInputs.nullifier, /^0x[a-f0-9]{64}$/);
  assert.notDeepEqual(first.proof.a, [0n, 0n]);
});

test('generateProof uses configured circom prover output when enabled', async () => {
  const agentBytes32 = `0x${DEFAULT_AGENT.slice(2).padStart(64, '0')}`;
  const sessionBytes32 = `0x${'ab'.repeat(32)}`;
  const merkleRoot = `0x${'cd'.repeat(32)}`;
  const nullifier = `0x${'ef'.repeat(32)}`;

  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
    proofGeneration: {
      mode: 'circom',
      prover: async () => ({
        contractProof: {
          a: ['1', '2'],
          b: [['3', '4'], ['5', '6']],
          c: ['7', '8'],
        },
        publicSignals: [
          BigInt(agentBytes32).toString(),
          BigInt(sessionBytes32).toString(),
          '2',
          '1700000010000',
          '1700000030000',
          BigInt(merkleRoot).toString(),
          BigInt(nullifier).toString(),
        ],
      }),
    },
  });

  await usage.logUsage('session-2', {
    endpoint: '/v1/data',
    method: 'POST',
    timestamp: 1_700_000_010_000,
  });
  await usage.logUsage('session-2', {
    endpoint: '/v1/data',
    method: 'POST',
    timestamp: 1_700_000_020_000,
  });

  const result = await usage.generateProof('session-2', 1_700_000_030_000);

  assert.deepEqual(result.proof, {
    a: [1n, 2n],
    b: [[3n, 4n], [5n, 6n]],
    c: [7n, 8n],
  });
  assert.equal(result.publicInputs.agentAddress, agentBytes32);
  assert.equal(result.publicInputs.sessionId, sessionBytes32);
  assert.equal(result.publicInputs.callCount, 2n);
  assert.equal(result.publicInputs.merkleRoot, merkleRoot);
  assert.equal(result.publicInputs.nullifier, nullifier);
});

test('generateProof fails clearly when circom mode is forced without prover/artifacts', async () => {
  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
    proofGeneration: {
      mode: 'circom',
      circuitsDir: '/tmp/non-existent-circuits-dir',
    },
  });

  await usage.logUsage('session-missing-artifacts', {
    endpoint: '/v1/data',
    method: 'GET',
    timestamp: 1_700_001_000_000,
  });

  await assert.rejects(
    usage.generateProof('session-missing-artifacts', 1_700_001_010_000),
    /Circom proof mode is enabled, but proof generation could not run/,
  );
});

test('submitProof computes settlement amount from call count and rate', async () => {
  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
    settlementRatePerCall: 7n,
  });

  await usage.logUsage('session-3', {
    endpoint: '/metrics',
    method: 'GET',
    timestamp: 1_700_000_100_000,
  });
  await usage.logUsage('session-3', {
    endpoint: '/metrics',
    method: 'GET',
    timestamp: 1_700_000_101_000,
  });
  await usage.logUsage('session-3', {
    endpoint: '/metrics',
    method: 'GET',
    timestamp: 1_700_000_102_000,
  });

  const { proof, publicInputs } = await usage.generateProof('session-3', 1_700_000_103_000);
  const settlement = await usage.submitProof(proof, publicInputs);

  assert.equal(settlement.callCount, 3n);
  assert.equal(settlement.settlementAmount, 21n);
  assert.match(settlement.transactionHash, /^0x[a-f0-9]{64}$/);
});

test('submitProof writes to zk verifier when onchain mode is enabled', async () => {
  const txHash = `0x${'a'.repeat(64)}`;
  const writes = [];
  const waits = [];
  const reads = [];

  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
    settlementRatePerCall: 5n,
    onchain: {
      enabled: true,
      chainId: 11155111,
      zkUsageVerifierAddress: `0x${'2'.repeat(40)}`,
      defaultPlanId: 0n,
      publicClient: {
        readContract: async (args) => {
          reads.push(args);
          return 9n;
        },
        waitForTransactionReceipt: async (args) => {
          waits.push(args);
          return { status: 'success' };
        },
      },
      walletClient: {
        writeContract: async (args) => {
          writes.push(args);
          return txHash;
        },
      },
    },
  });

  await usage.logUsage('session-string-id', {
    endpoint: '/premium',
    method: 'GET',
    timestamp: 1_700_000_200_000,
  });

  const { proof, publicInputs } = await usage.generateProof('session-string-id', 1_700_000_210_000);
  const settlement = await usage.submitProof(proof, publicInputs);

  assert.equal(settlement.transactionHash, txHash);
  assert.equal(settlement.settlementAmount, 9n);
  assert.equal(writes.length, 1);
  assert.equal(reads.length, 1);
  assert.equal(waits.length, 1);
  assert.equal(writes[0].functionName, 'submitProof');
  assert.match(writes[0].args[1].agentAddress, /^0x[a-f0-9]{64}$/);
  assert.match(writes[0].args[1].sessionId, /^0x[a-f0-9]{64}$/);
  assert.match(writes[0].args[1].merkleRoot, /^0x[a-f0-9]{64}$/);
  assert.match(writes[0].args[1].nullifier, /^0x[a-f0-9]{64}$/);
});

test('clearLogs only removes entries up to the settled window', async () => {
  const usage = new UsageService({
    signingKey: 'unit-test-signing-key',
    agentAddress: DEFAULT_AGENT,
  });

  await usage.logUsage('session-4', {
    endpoint: '/x',
    method: 'GET',
    timestamp: 1_000,
  });
  await usage.logUsage('session-4', {
    endpoint: '/x',
    method: 'GET',
    timestamp: 2_000,
  });
  await usage.logUsage('session-4', {
    endpoint: '/x',
    method: 'GET',
    timestamp: 3_000,
  });

  usage.clearLogs('session-4', 2_000);
  assert.equal(usage.getUsageCount('session-4'), 1);

  const remaining = usage.aggregateUsage('session-4', 10_000);
  assert.equal(remaining.callCount, 1);
  assert.equal(remaining.logs[0].callData.timestamp, 3_000);
});
