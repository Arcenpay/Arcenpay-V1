// ============================================================
//  @meap/node — Usage Logging & Proof Generation Service
// ============================================================

import { createHash, createHmac } from 'crypto';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import {
  ZKUsageVerifierABI,
  getContractAddresses,
  type PublicInputs,
  type UsageProof,
  type BillingSettlement,
} from '@meap/core';
import { createPublicClient, createWalletClient, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia, baseSepolia, base } from 'viem/chains';

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

interface UsageServiceConfig {
  signingKey?: string;
  agentAddress?: string;
  settlementRatePerCall?: bigint;
  proofGeneration?: ProofGenerationConfig;
  onchain?: OnchainSubmissionConfig;
}

type ProofGenerationMode = 'auto' | 'deterministic' | 'circom';

interface CircomProofInput {
  agentAddress: string;
  sessionId: string;
  callCount: string;
  windowStart: string;
  windowEnd: string;
  merkleRoot: string;
  nullifier: string;
  logHashes: string[];
  logTimestamps: string[];
}

interface CircomProofOutput {
  proof?: unknown;
  contractProof?: {
    a: [string | bigint, string | bigint];
    b: [
      [string | bigint, string | bigint],
      [string | bigint, string | bigint],
    ];
    c: [string | bigint, string | bigint];
  };
  publicSignals?: Array<string | bigint>;
}

interface ProofGenerationConfig {
  mode?: ProofGenerationMode;
  circuitsDir?: string;
  proveScriptPath?: string;
  prover?: (input: CircomProofInput) => Promise<CircomProofOutput>;
}

interface OnchainPublicClient {
  readContract(args: any): Promise<any>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<any>;
}

interface OnchainWalletClient {
  writeContract(args: any): Promise<Hex>;
}

interface OnchainSubmissionConfig {
  enabled?: boolean;
  chainId?: number;
  rpcUrl?: string;
  privateKey?: `0x${string}`;
  zkUsageVerifierAddress?: `0x${string}`;
  waitForReceipt?: boolean;
  defaultPlanId?: bigint;
  publicClient?: OnchainPublicClient;
  walletClient?: OnchainWalletClient;
}

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

const SNARK_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Usage logging and proof generation service
 * Used by the Facilitator Node to track API consumption and generate zk-SNARK proofs
 */
export class UsageService {
  private logs: Map<string, UsageLogEntry[]> = new Map();
  private readonly signingKey: string;
  private readonly agentAddress: string;
  private readonly settlementRatePerCall: bigint;
  private readonly proofMode: ProofGenerationMode;
  private readonly circuitsDir: string;
  private readonly proveScriptPath: string;
  private readonly proofGenerator: ((input: CircomProofInput) => Promise<CircomProofOutput>) | null;
  private readonly onchainEnabled: boolean;
  private readonly onchainDefaultPlanId: bigint;
  private readonly onchainWaitForReceipt: boolean;
  private readonly zkUsageVerifierAddress: `0x${string}` | null;
  private readonly onchainPublicClient: OnchainPublicClient | null;
  private readonly onchainWalletClient: OnchainWalletClient | null;

  constructor(config: UsageServiceConfig = {}) {
    this.signingKey = config.signingKey || process.env.MEAP_USAGE_SIGNING_KEY || 'meap-dev-signing-key';

    const agentAddress = config.agentAddress || process.env.MEAP_USAGE_AGENT_ADDRESS || `0x${'0'.repeat(40)}`;
    if (!/^0x[a-fA-F0-9]{40}$/.test(agentAddress)) {
      throw new Error('UsageService agentAddress must be a valid 20-byte hex address.');
    }
    this.agentAddress = agentAddress.toLowerCase();
    this.settlementRatePerCall = config.settlementRatePerCall ?? 1n;
    this.proofMode =
      config.proofGeneration?.mode
      || (process.env.MEAP_USAGE_PROOF_MODE as ProofGenerationMode | undefined)
      || 'auto';
    this.circuitsDir = resolve(config.proofGeneration?.circuitsDir || process.env.MEAP_CIRCUITS_DIR || 'circuits');
    this.proveScriptPath = resolve(
      config.proofGeneration?.proveScriptPath
      || join(this.circuitsDir, 'scripts', 'prove.js'),
    );
    this.proofGenerator = config.proofGeneration?.prover || null;
    this.onchainEnabled = Boolean(
      config.onchain?.enabled ?? process.env.MEAP_USAGE_ONCHAIN_SUBMIT === 'true',
    );
    this.onchainDefaultPlanId = config.onchain?.defaultPlanId ?? 0n;
    this.onchainWaitForReceipt = config.onchain?.waitForReceipt ?? true;
    this.zkUsageVerifierAddress = null;
    this.onchainPublicClient = null;
    this.onchainWalletClient = null;

    if (this.onchainEnabled) {
      const {
        zkUsageVerifierAddress,
        onchainPublicClient,
        onchainWalletClient,
      } = this.initializeOnchainSubmission(config.onchain);

      this.zkUsageVerifierAddress = zkUsageVerifierAddress;
      this.onchainPublicClient = onchainPublicClient;
      this.onchainWalletClient = onchainWalletClient;
    }
  }

  /**
   * Records a signed consumption event to the off-chain aggregator
   */
  async logUsage(sessionId: string, callData: UsageLogEntry['callData']): Promise<void> {
    const signature = this.signEntry(sessionId, callData);
    const entry: UsageLogEntry = {
      sessionId,
      callData,
      signature,
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
   * Uses Circom prover when configured/artifacts are present, otherwise falls back
   * to deterministic placeholder proofs for local development.
   */
  async generateProof(
    sessionId: string,
    windowEnd: number,
  ): Promise<{ proof: UsageProof; publicInputs: PublicInputs }> {
    const aggregation = this.aggregateUsage(sessionId, windowEnd);
    const logHashes = aggregation.logs.map((entry) => this.hashEntry(entry));
    const merkleRoot = this.computeMerkleRoot(logHashes);
    const nullifier = this.hashHex(
      `${sessionId}|${aggregation.windowStart}|${aggregation.windowEnd}|${merkleRoot}`,
    );

    const basePublicInputs: PublicInputs = {
      agentAddress: this.agentAddress,
      sessionId,
      callCount: BigInt(aggregation.callCount),
      windowStart: BigInt(aggregation.windowStart),
      windowEnd: BigInt(aggregation.windowEnd),
      merkleRoot,
      nullifier,
    };

    const shouldTryCircom =
      this.proofMode === 'circom'
      || (this.proofMode === 'auto' && this.hasCircomArtifacts());

    if (shouldTryCircom) {
      const circomResult = await this.generateProofViaCircom(aggregation, basePublicInputs);
      if (circomResult) {
        return circomResult;
      }
      if (this.proofMode === 'circom') {
        throw new Error('Circom proof mode is enabled, but proof generation could not run.');
      }
    }

    const proof = this.deriveProofPlaceholder(basePublicInputs);
    return { proof, publicInputs: basePublicInputs };
  }

  /**
   * Submits generated proof to ZKUsageVerifier.sol for settlement
   * Returns deterministic settlement output for local/integration workflows.
   */
  async submitProof(
    proof: UsageProof,
    publicInputs: PublicInputs,
  ): Promise<BillingSettlement> {
    const normalizedProof = this.normalizeProofForContract(proof);
    const normalizedInputs = this.normalizeInputsForContract(publicInputs);

    if (
      this.onchainEnabled
      && this.zkUsageVerifierAddress
      && this.onchainPublicClient
      && this.onchainWalletClient
    ) {
      const txHash = await this.onchainWalletClient.writeContract({
        address: this.zkUsageVerifierAddress,
        abi: ZKUsageVerifierABI,
        functionName: 'submitProof',
        args: [normalizedProof, normalizedInputs],
      });

      if (this.onchainWaitForReceipt) {
        await this.onchainPublicClient.waitForTransactionReceipt({ hash: txHash });
      }

      const onchainRate = await this.readOnchainRatePerCall();
      const settlementAmount = publicInputs.callCount * onchainRate;

      return {
        sessionId: publicInputs.sessionId,
        agentAddress: publicInputs.agentAddress,
        callCount: publicInputs.callCount,
        settlementAmount,
        windowStart: publicInputs.windowStart,
        windowEnd: publicInputs.windowEnd,
        transactionHash: txHash,
      };
    }

    const settlementAmount = publicInputs.callCount * this.settlementRatePerCall;
    const transactionHash = this.hashHex(
      [
        normalizedInputs.sessionId,
        normalizedInputs.agentAddress,
        normalizedInputs.callCount.toString(),
        normalizedProof.a.map((v) => v.toString()).join(','),
        normalizedProof.b.flat().map((v) => v.toString()).join(','),
        normalizedProof.c.map((v) => v.toString()).join(','),
      ].join('|'),
    );

    return {
      sessionId: publicInputs.sessionId,
      agentAddress: publicInputs.agentAddress,
      callCount: publicInputs.callCount,
      settlementAmount,
      windowStart: publicInputs.windowStart,
      windowEnd: publicInputs.windowEnd,
      transactionHash,
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

  private signEntry(sessionId: string, callData: UsageLogEntry['callData']): string {
    const payload = this.serializeUsagePayload(sessionId, callData);
    return `0x${createHmac('sha256', this.signingKey).update(payload).digest('hex')}`;
  }

  private serializeUsagePayload(sessionId: string, callData: UsageLogEntry['callData']): string {
    const responseSize = callData.responseSize ?? 0;
    return `${sessionId}|${callData.endpoint}|${callData.method}|${callData.timestamp}|${responseSize}`;
  }

  private hashEntry(entry: UsageLogEntry): string {
    return this.hashHex(
      `${this.serializeUsagePayload(entry.sessionId, entry.callData)}|${entry.signature || ''}`,
    );
  }

  private hashHex(value: string): string {
    return `0x${createHash('sha256').update(value).digest('hex')}`;
  }

  private computeMerkleRoot(hashes: string[]): string {
    if (hashes.length === 0) {
      return `0x${'0'.repeat(64)}`;
    }

    const leafZero = `0x${'0'.repeat(64)}`;
    const level = [...hashes];

    while (level.length & (level.length - 1)) {
      level.push(leafZero);
    }

    let current = level;
    while (current.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += 2) {
        next.push(this.hashHex(`${current[i]}${current[i + 1].slice(2)}`));
      }
      current = next;
    }

    return current[0];
  }

  private hashToBigInt(value: string): bigint {
    return BigInt(this.hashHex(value));
  }

  private deriveProofPlaceholder(publicInputs: PublicInputs): UsageProof {
    const seed = [
      publicInputs.agentAddress,
      publicInputs.sessionId,
      publicInputs.callCount.toString(),
      publicInputs.windowStart.toString(),
      publicInputs.windowEnd.toString(),
      publicInputs.merkleRoot,
      publicInputs.nullifier,
    ].join('|');

    return {
      a: [this.hashToBigInt(`${seed}|a0`), this.hashToBigInt(`${seed}|a1`)],
      b: [
        [this.hashToBigInt(`${seed}|b00`), this.hashToBigInt(`${seed}|b01`)],
        [this.hashToBigInt(`${seed}|b10`), this.hashToBigInt(`${seed}|b11`)],
      ],
      c: [this.hashToBigInt(`${seed}|c0`), this.hashToBigInt(`${seed}|c1`)],
    };
  }

  private hasCircomArtifacts(): boolean {
    return (
      existsSync(this.proveScriptPath)
      && existsSync(join(this.circuitsDir, 'build', 'UsageBilling_js', 'UsageBilling.wasm'))
      && existsSync(join(this.circuitsDir, 'build', 'circuit_final.zkey'))
    );
  }

  private async generateProofViaCircom(
    aggregation: UsageAggregation,
    basePublicInputs: PublicInputs,
  ): Promise<{ proof: UsageProof; publicInputs: PublicInputs } | null> {
    if (!this.proofGenerator && !existsSync(this.proveScriptPath)) {
      return null;
    }

    const normalizedInputs = this.normalizeInputsForContract(basePublicInputs);
    const logHashes = aggregation.logs.map((entry) => this.hashEntry(entry));
    const logTimestamps = aggregation.logs.map((entry) => this.toFieldString(entry.callData.timestamp));
    const commitment = this.computeCircomCommitment(logHashes, logTimestamps);

    const input: CircomProofInput = {
      agentAddress: this.toFieldString(normalizedInputs.agentAddress),
      sessionId: this.toFieldString(normalizedInputs.sessionId),
      callCount: this.toFieldString(normalizedInputs.callCount),
      windowStart: this.toFieldString(normalizedInputs.windowStart),
      windowEnd: this.toFieldString(normalizedInputs.windowEnd),
      merkleRoot: commitment,
      nullifier: this.toFieldString(normalizedInputs.nullifier),
      logHashes: logHashes.map((value) => this.toFieldString(value)),
      logTimestamps,
    };

    const proveOutput = this.proofGenerator
      ? await this.proofGenerator(input)
      : await this.callLocalProver(input);

    const proof = this.parseCircomProof(proveOutput);
    const publicInputs = this.parseCircomPublicInputs(
      proveOutput?.publicSignals,
      normalizedInputs,
    );

    return { proof, publicInputs };
  }

  private async callLocalProver(input: CircomProofInput): Promise<CircomProofOutput> {
    const proveModule = await import(pathToFileURL(this.proveScriptPath).href);
    const prove = (
      (proveModule as Record<string, unknown>).prove
      || ((proveModule as Record<string, unknown>).default as Record<string, unknown> | undefined)?.prove
    ) as ((args: CircomProofInput) => Promise<CircomProofOutput>) | undefined;

    if (typeof prove !== 'function') {
      throw new Error(`No prove() export found in ${this.proveScriptPath}`);
    }

    return prove(input);
  }

  private parseCircomProof(result: CircomProofOutput): UsageProof {
    const fromContractProof = result?.contractProof;
    if (fromContractProof) {
      return {
        a: [BigInt(fromContractProof.a[0]), BigInt(fromContractProof.a[1])],
        b: [
          [BigInt(fromContractProof.b[0][0]), BigInt(fromContractProof.b[0][1])],
          [BigInt(fromContractProof.b[1][0]), BigInt(fromContractProof.b[1][1])],
        ],
        c: [BigInt(fromContractProof.c[0]), BigInt(fromContractProof.c[1])],
      };
    }

    const proof = result?.proof as
      | {
          a?: [string | bigint, string | bigint];
          b?: [[string | bigint, string | bigint], [string | bigint, string | bigint]];
          c?: [string | bigint, string | bigint];
          pi_a?: [string | bigint, string | bigint, string | bigint];
          pi_b?: [
            [string | bigint, string | bigint],
            [string | bigint, string | bigint],
            [string | bigint, string | bigint],
          ];
          pi_c?: [string | bigint, string | bigint, string | bigint];
        }
      | undefined;

    if (!proof) {
      throw new Error('Circom prover did not return a proof object.');
    }

    if (proof.a && proof.b && proof.c) {
      return {
        a: [BigInt(proof.a[0]), BigInt(proof.a[1])],
        b: [
          [BigInt(proof.b[0][0]), BigInt(proof.b[0][1])],
          [BigInt(proof.b[1][0]), BigInt(proof.b[1][1])],
        ],
        c: [BigInt(proof.c[0]), BigInt(proof.c[1])],
      };
    }

    if (proof.pi_a && proof.pi_b && proof.pi_c) {
      return {
        a: [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])],
        b: [
          [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
          [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
        ],
        c: [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])],
      };
    }

    throw new Error('Unsupported proof format from Circom prover.');
  }

  private parseCircomPublicInputs(
    publicSignals: Array<string | bigint> | undefined,
    fallback: {
      agentAddress: `0x${string}`;
      sessionId: `0x${string}`;
      callCount: bigint;
      windowStart: bigint;
      windowEnd: bigint;
      merkleRoot: `0x${string}`;
      nullifier: `0x${string}`;
    },
  ): PublicInputs {
    if (!publicSignals || publicSignals.length < 7) {
      return {
        agentAddress: fallback.agentAddress,
        sessionId: fallback.sessionId,
        callCount: fallback.callCount,
        windowStart: fallback.windowStart,
        windowEnd: fallback.windowEnd,
        merkleRoot: fallback.merkleRoot,
        nullifier: fallback.nullifier,
      };
    }

    return {
      agentAddress: this.fieldToBytes32(publicSignals[0]),
      sessionId: this.fieldToBytes32(publicSignals[1]),
      callCount: BigInt(publicSignals[2]),
      windowStart: this.ensureUint64(BigInt(publicSignals[3]), 'windowStart'),
      windowEnd: this.ensureUint64(BigInt(publicSignals[4]), 'windowEnd'),
      merkleRoot: this.fieldToBytes32(publicSignals[5]),
      nullifier: this.fieldToBytes32(publicSignals[6]),
    };
  }

  private initializeOnchainSubmission(
    config: OnchainSubmissionConfig | undefined,
  ): {
    zkUsageVerifierAddress: `0x${string}`;
    onchainPublicClient: OnchainPublicClient;
    onchainWalletClient: OnchainWalletClient;
  } {
    if (config?.publicClient && config?.walletClient) {
      const chainId = config.chainId || 11155111;
      const contracts = getContractAddresses(chainId);
      const verifierAddress = (
        config.zkUsageVerifierAddress
        || contracts.zkUsageVerifier
      ) as `0x${string}`;

      if (!isAddress(verifierAddress)) {
        throw new Error('UsageService onchain zkUsageVerifierAddress is invalid.');
      }

      return {
        zkUsageVerifierAddress: verifierAddress,
        onchainPublicClient: config.publicClient,
        onchainWalletClient: config.walletClient,
      };
    }

    const chainId = config?.chainId || Number(process.env.CHAIN_ID || 11155111);
    const rpcUrl = config?.rpcUrl || process.env.RPC_URL;
    const privateKey =
      config?.privateKey
      || (process.env.MEAP_USAGE_PRIVATE_KEY as `0x${string}` | undefined)
      || (process.env.PRIVATE_KEY as `0x${string}` | undefined);

    if (!rpcUrl) {
      throw new Error('UsageService onchain submission requires rpcUrl.');
    }
    if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
      throw new Error('UsageService onchain submission requires a valid 32-byte private key.');
    }

    const chain = CHAIN_MAP[chainId] || sepolia;
    const account = privateKeyToAccount(privateKey);
    const contracts = getContractAddresses(chainId);
    const verifierAddress = (
      config?.zkUsageVerifierAddress
      || contracts.zkUsageVerifier
    ) as `0x${string}`;

    if (!isAddress(verifierAddress)) {
      throw new Error('UsageService onchain zkUsageVerifierAddress is invalid.');
    }

    return {
      zkUsageVerifierAddress: verifierAddress,
      onchainPublicClient: createPublicClient({
        chain,
        transport: http(rpcUrl),
      }) as OnchainPublicClient,
      onchainWalletClient: createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
      }) as OnchainWalletClient,
    };
  }

  private normalizeProofForContract(proof: UsageProof): UsageProof {
    return {
      a: [BigInt(proof.a[0]), BigInt(proof.a[1])],
      b: [
        [BigInt(proof.b[0][0]), BigInt(proof.b[0][1])],
        [BigInt(proof.b[1][0]), BigInt(proof.b[1][1])],
      ],
      c: [BigInt(proof.c[0]), BigInt(proof.c[1])],
    };
  }

  private normalizeInputsForContract(publicInputs: PublicInputs): {
    agentAddress: `0x${string}`;
    sessionId: `0x${string}`;
    callCount: bigint;
    windowStart: bigint;
    windowEnd: bigint;
    merkleRoot: `0x${string}`;
    nullifier: `0x${string}`;
  } {
    return {
      agentAddress: this.toBytes32(publicInputs.agentAddress, { allowAddress: true }),
      sessionId: this.toBytes32(publicInputs.sessionId),
      callCount: BigInt(publicInputs.callCount),
      windowStart: this.ensureUint64(publicInputs.windowStart, 'windowStart'),
      windowEnd: this.ensureUint64(publicInputs.windowEnd, 'windowEnd'),
      merkleRoot: this.toBytes32(publicInputs.merkleRoot),
      nullifier: this.toBytes32(publicInputs.nullifier),
    };
  }

  private ensureUint64(value: bigint, field: string): bigint {
    const normalized = BigInt(value);
    if (normalized < 0n || normalized > MAX_UINT64) {
      throw new Error(`${field} must fit within uint64.`);
    }
    return normalized;
  }

  private toBytes32(
    value: string,
    options: { allowAddress?: boolean } = {},
  ): `0x${string}` {
    const normalized = value.trim();

    if (/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
      return normalized.toLowerCase() as `0x${string}`;
    }

    if (options.allowAddress && /^0x[a-fA-F0-9]{40}$/.test(normalized)) {
      return `0x${normalized.slice(2).padStart(64, '0').toLowerCase()}` as `0x${string}`;
    }

    return this.hashHex(normalized) as `0x${string}`;
  }

  private toFieldString(value: string | bigint | number): string {
    let parsed: bigint;

    if (typeof value === 'bigint' || typeof value === 'number') {
      parsed = BigInt(value);
    } else {
      const normalized = value.trim();
      if (/^0x[a-fA-F0-9]+$/.test(normalized)) {
        parsed = BigInt(normalized);
      } else if (/^-?[0-9]+$/.test(normalized)) {
        parsed = BigInt(normalized);
      } else {
        throw new Error(`Invalid field value: ${value}`);
      }
    }

    const modded = this.modField(parsed);
    return modded.toString();
  }

  private fieldToBytes32(value: string | bigint): `0x${string}` {
    const asBigInt = this.modField(BigInt(value));
    if (asBigInt < 0n) {
      throw new Error('Field value cannot be negative.');
    }
    return `0x${asBigInt.toString(16).padStart(64, '0')}` as `0x${string}`;
  }

  private modField(value: bigint): bigint {
    let normalized = value % SNARK_FIELD;
    if (normalized < 0n) {
      normalized += SNARK_FIELD;
    }
    return normalized;
  }

  private computeCircomCommitment(logHashes: string[], logTimestamps: string[]): string {
    let acc = 0n;
    for (let i = 0; i < logHashes.length; i += 1) {
      const logHash = this.modField(BigInt(this.toFieldString(logHashes[i])));
      const timestamp = this.modField(BigInt(this.toFieldString(logTimestamps[i])));
      acc = this.modField(acc + this.modField(logHash + timestamp));
    }
    return acc.toString();
  }

  private async readOnchainRatePerCall(): Promise<bigint> {
    if (!this.onchainEnabled || !this.onchainPublicClient || !this.zkUsageVerifierAddress) {
      return this.settlementRatePerCall;
    }

    try {
      const rate = await this.onchainPublicClient.readContract({
        address: this.zkUsageVerifierAddress,
        abi: ZKUsageVerifierABI,
        functionName: 'getRateSchedule',
        args: [this.onchainDefaultPlanId],
      });
      const normalizedRate = BigInt(rate as bigint | number | string);
      if (normalizedRate <= 0n) {
        return this.settlementRatePerCall;
      }
      return normalizedRate;
    } catch {
      return this.settlementRatePerCall;
    }
  }
}
