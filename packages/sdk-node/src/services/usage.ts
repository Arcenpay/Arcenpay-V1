// ============================================================
//  @meap/node — Usage Logging & Proof Generation Service
//  Deterministic ZKVUB runtime with strict/dev proof modes.
// ============================================================

import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia, baseSepolia, base } from "viem/chains";
import type { PublicInputs, UsageProof, BillingSettlement } from "@meap/core";
import { ZKUsageVerifierABI, getContractAddresses } from "@meap/core";

interface UsageLogEntry {
  sessionId: string;
  callData: {
    endpoint: string;
    method: string;
    timestamp: number;
    responseSize?: number;
  };
  signature: string;
}

interface UsageAggregation {
  sessionId: string;
  callCount: number;
  windowStart: number;
  windowEnd: number;
  logs: UsageLogEntry[];
}

type Groth16ProofResult = { proof: any; publicSignals: string[] };
type CircuitProverModule = {
  prove: (input: Record<string, unknown>) => Promise<Groth16ProofResult>;
  sessionIdToField?: (sessionId: string) => string;
};

export type ProofMode = "strict" | "dev";

export const UsageProofErrorCodes = {
  TOOLING_UNAVAILABLE: "TOOLING_UNAVAILABLE",
  ARTIFACTS_MISSING: "ARTIFACTS_MISSING",
  ARTIFACT_VERSION_MISMATCH: "ARTIFACT_VERSION_MISMATCH",
  INVALID_VERIFICATION_KEY: "INVALID_VERIFICATION_KEY",
  INVALID_INPUT: "INVALID_INPUT",
  PROOF_GENERATION_FAILED: "PROOF_GENERATION_FAILED",
  PROOF_SIGNAL_MISMATCH: "PROOF_SIGNAL_MISMATCH",
} as const;

export type UsageProofErrorCode =
  (typeof UsageProofErrorCodes)[keyof typeof UsageProofErrorCodes];

export class UsageProofError extends Error {
  readonly code: UsageProofErrorCode;
  readonly cause?: unknown;

  constructor(code: UsageProofErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "UsageProofError";
    this.code = code;
    this.cause = cause;
  }
}

export interface UsageServiceConfig {
  signerPrivateKey?: string;
  chainId?: number;
  rpcUrl?: string;
  proofMode?: ProofMode;
  circuitsRootDir?: string;
  circuitBuildDir?: string;
  circuitWasmPath?: string;
  zkeyPath?: string;
  verificationKeyPath?: string;
  proveScriptPath?: string;
  artifactVersion?: string;
  artifactManifestPath?: string;
}

const CHAIN_MAP: Record<number, any> = {
  11155111: sepolia,
  84532: baseSepolia,
  8453: base,
};

const MAX_ENTRIES = 128;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export class UsageService {
  private logs: Map<string, UsageLogEntry[]> = new Map();
  private readonly config: Required<
    Pick<
      UsageServiceConfig,
      | "chainId"
      | "rpcUrl"
      | "proofMode"
      | "circuitsRootDir"
      | "circuitBuildDir"
      | "circuitWasmPath"
      | "zkeyPath"
      | "verificationKeyPath"
      | "proveScriptPath"
      | "artifactVersion"
      | "artifactManifestPath"
    >
  > &
    Pick<UsageServiceConfig, "signerPrivateKey">;
  private readonly signerAccount: ReturnType<typeof privateKeyToAccount> | null;
  private readonly publicClient: any;
  private readonly walletClient: any;
  private runtimeValidated = false;

  constructor(config: UsageServiceConfig = {}) {
    const chainId = config.chainId ?? 11155111;
    const chain = CHAIN_MAP[chainId] || sepolia;
    const rpcUrl = config.rpcUrl || chain.rpcUrls.default.http[0];
    const proofMode: ProofMode =
      config.proofMode ??
      (process.env.NODE_ENV === "development" ? "dev" : "strict");

    const circuitsRootDir = this.resolveCircuitsRoot(config.circuitsRootDir);
    const buildDir =
      config.circuitBuildDir || path.join(circuitsRootDir, "build");

    this.config = {
      chainId,
      rpcUrl,
      proofMode,
      circuitsRootDir,
      circuitBuildDir: buildDir,
      circuitWasmPath:
        config.circuitWasmPath ||
        path.join(buildDir, "UsageBilling_js", "UsageBilling.wasm"),
      zkeyPath: config.zkeyPath || path.join(buildDir, "circuit_final.zkey"),
      verificationKeyPath:
        config.verificationKeyPath ||
        path.join(buildDir, "verification_key.json"),
      proveScriptPath:
        config.proveScriptPath ||
        path.join(circuitsRootDir, "scripts", "prove.js"),
      artifactVersion:
        config.artifactVersion ||
        process.env.MEAP_PROOF_ARTIFACT_VERSION ||
        "",
      artifactManifestPath:
        config.artifactManifestPath ||
        process.env.MEAP_PROOF_ARTIFACT_MANIFEST_PATH ||
        path.join(circuitsRootDir, "artifact-manifest.json"),
      signerPrivateKey: config.signerPrivateKey,
    };

    if (config.signerPrivateKey) {
      const key = config.signerPrivateKey.startsWith("0x")
        ? config.signerPrivateKey
        : `0x${config.signerPrivateKey}`;
      this.signerAccount = privateKeyToAccount(key as `0x${string}`);
    } else {
      this.signerAccount = null;
    }

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    });

    if (this.signerAccount) {
      this.walletClient = createWalletClient({
        account: this.signerAccount,
        chain,
        transport: http(rpcUrl),
      });
    } else {
      this.walletClient = null;
    }

    if (this.config.proofMode === "strict") {
      this.assertProofRuntimeReady();
    }
  }

  getProofMode(): ProofMode {
    return this.config.proofMode;
  }

  getProofRuntimeConfig(): {
    proofMode: ProofMode;
    proveScriptPath: string;
    circuitWasmPath: string;
    zkeyPath: string;
    verificationKeyPath: string;
    artifactVersion: string;
    artifactManifestPath: string;
  } {
    return {
      proofMode: this.config.proofMode,
      proveScriptPath: this.config.proveScriptPath,
      circuitWasmPath: this.config.circuitWasmPath,
      zkeyPath: this.config.zkeyPath,
      verificationKeyPath: this.config.verificationKeyPath,
      artifactVersion: this.config.artifactVersion,
      artifactManifestPath: this.config.artifactManifestPath,
    };
  }

  assertProofRuntimeReady(): void {
    this.assertProofTooling();
    this.assertProofArtifacts();
    this.assertVerificationKey();
    this.runtimeValidated = true;
  }

  async logUsage(
    sessionId: string,
    callData: UsageLogEntry["callData"],
  ): Promise<void> {
    const message = JSON.stringify({
      sessionId,
      endpoint: callData.endpoint,
      method: callData.method,
      timestamp: callData.timestamp,
      responseSize: callData.responseSize ?? 0,
    });

    let signature = "";
    if (this.signerAccount) {
      try {
        signature = await this.signerAccount.signMessage({ message });
      } catch (err) {
        console.error("[UsageService] Failed to sign log entry:", err);
        signature = createHash("sha256").update(message).digest("hex");
      }
    } else {
      signature = createHash("sha256").update(message).digest("hex");
    }

    const entry: UsageLogEntry = { sessionId, callData, signature };
    const existing = this.logs.get(sessionId) || [];
    existing.push(entry);
    this.logs.set(sessionId, existing);
  }

  getUsageCount(sessionId: string): number {
    return (this.logs.get(sessionId) || []).length;
  }

  getAllSessions(): string[] {
    return Array.from(this.logs.keys());
  }

  aggregateUsage(sessionId: string, windowEnd: number): UsageAggregation {
    const logs = this.logs.get(sessionId) || [];
    const windowLogs = logs.filter((entry) => entry.callData.timestamp <= windowEnd);
    const windowStart =
      windowLogs.length > 0
        ? Math.min(...windowLogs.map((entry) => entry.callData.timestamp))
        : 0;

    return {
      sessionId,
      callCount: windowLogs.length,
      windowStart,
      windowEnd,
      logs: windowLogs,
    };
  }

  async generateProof(
    sessionId: string,
    windowEnd: number,
  ): Promise<{ proof: UsageProof; publicInputs: PublicInputs }> {
    const aggregation = this.aggregateUsage(sessionId, windowEnd);

    if (aggregation.callCount <= 0) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_INPUT,
        `No usage entries available for session ${sessionId}.`,
      );
    }
    if (aggregation.callCount > MAX_ENTRIES) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_INPUT,
        `Usage batch too large (${aggregation.callCount} > ${MAX_ENTRIES}).`,
      );
    }
    if (aggregation.windowEnd <= aggregation.windowStart) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_INPUT,
        "Billing window end must be greater than window start.",
      );
    }

    const sessionIdBytes32 = this.normalizeBytes32(sessionId);
    const agentAddress = this.signerAccount?.address || ZERO_ADDRESS;
    const agentAddressBytes32 = this.addressToBytes32(agentAddress);
    const logHashes = aggregation.logs.map((log) => this.hashUsageLog(log));
    const logTimestamps = aggregation.logs.map((log) =>
      String(log.callData.timestamp),
    );

    const circuitInput = {
      agentAddress,
      sessionId: sessionIdBytes32,
      callCount: aggregation.callCount,
      windowStart: aggregation.windowStart,
      windowEnd: aggregation.windowEnd,
      logHashes,
      logTimestamps,
    };

    let proofResult: Groth16ProofResult | null = null;
    let publicSignals: string[] | null = null;

    try {
      this.assertProofRuntimeReady();
      const prover = await this.loadCircuitProver();
      proofResult = await prover.prove(circuitInput);
      publicSignals = proofResult.publicSignals;
      this.assertPublicSignals(publicSignals, aggregation, agentAddress, sessionIdBytes32, prover);
    } catch (err) {
      if (this.config.proofMode === "strict") {
        throw this.wrapProofError(err);
      }
      console.warn(
        "[UsageService] Proof generation unavailable in dev mode, using zero-proof envelope:",
        err,
      );
    }

    const proof: UsageProof = proofResult
      ? {
          a: [
            BigInt(proofResult.proof.pi_a[0]),
            BigInt(proofResult.proof.pi_a[1]),
          ],
          b: [
            [
              BigInt(proofResult.proof.pi_b[0][1]),
              BigInt(proofResult.proof.pi_b[0][0]),
            ],
            [
              BigInt(proofResult.proof.pi_b[1][1]),
              BigInt(proofResult.proof.pi_b[1][0]),
            ],
          ],
          c: [
            BigInt(proofResult.proof.pi_c[0]),
            BigInt(proofResult.proof.pi_c[1]),
          ],
        }
      : {
          a: [0n, 0n],
          b: [
            [0n, 0n],
            [0n, 0n],
          ],
          c: [0n, 0n],
        };

    const fallbackMerkleRoot = this.normalizeBytes32(logHashes.join(","));
    const fallbackNullifier = this.normalizeBytes32(
      `${sessionIdBytes32}:${aggregation.windowEnd}`,
    );

    const publicInputs: PublicInputs = publicSignals
      ? {
          agentAddress: this.fieldToBytes32(publicSignals[0]),
          sessionId: this.fieldToBytes32(publicSignals[1]),
          callCount: BigInt(publicSignals[2]),
          windowStart: BigInt(publicSignals[3]),
          windowEnd: BigInt(publicSignals[4]),
          merkleRoot: this.fieldToBytes32(publicSignals[5]),
          nullifier: this.fieldToBytes32(publicSignals[6]),
        }
      : {
          agentAddress: agentAddressBytes32,
          sessionId: sessionIdBytes32,
          callCount: BigInt(aggregation.callCount),
          windowStart: BigInt(aggregation.windowStart),
          windowEnd: BigInt(aggregation.windowEnd),
          merkleRoot: fallbackMerkleRoot,
          nullifier: fallbackNullifier,
        };

    return { proof, publicInputs };
  }

  async submitProof(
    proof: UsageProof,
    publicInputs: PublicInputs,
  ): Promise<BillingSettlement> {
    if (!this.walletClient) {
      throw new Error(
        "UsageService: Cannot submit proof — no signer private key configured. " +
          "Set signerPrivateKey in UsageServiceConfig.",
      );
    }

    const chainId = this.config.chainId || 11155111;
    const contracts = getContractAddresses(chainId);
    const verifierAddress = contracts.zkUsageVerifier as `0x${string}`;

    if (
      !verifierAddress ||
      verifierAddress === "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error(
        "UsageService: ZKUsageVerifier contract address not configured for this chain",
      );
    }

    const onChainProof = {
      a: proof.a as [bigint, bigint],
      b: proof.b as [[bigint, bigint], [bigint, bigint]],
      c: proof.c as [bigint, bigint],
    };

    const onChainInputs = {
      agentAddress: publicInputs.agentAddress as `0x${string}`,
      sessionId: publicInputs.sessionId as `0x${string}`,
      callCount: publicInputs.callCount,
      windowStart: publicInputs.windowStart,
      windowEnd: publicInputs.windowEnd,
      merkleRoot: publicInputs.merkleRoot as `0x${string}`,
      nullifier: publicInputs.nullifier as `0x${string}`,
    };

    const txHash = await this.walletClient.writeContract({
      address: verifierAddress,
      abi: ZKUsageVerifierABI,
      functionName: "submitProof",
      args: [onChainProof, onChainInputs],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    return {
      sessionId: publicInputs.sessionId,
      agentAddress: publicInputs.agentAddress,
      callCount: publicInputs.callCount,
      settlementAmount: 0n,
      windowStart: publicInputs.windowStart,
      windowEnd: publicInputs.windowEnd,
      transactionHash: receipt.transactionHash,
    };
  }

  clearLogs(sessionId: string, windowEnd: number): void {
    const logs = this.logs.get(sessionId) || [];
    this.logs.set(
      sessionId,
      logs.filter((entry) => entry.callData.timestamp > windowEnd),
    );
  }

  private resolveCircuitsRoot(explicitRoot?: string): string {
    if (explicitRoot) return path.resolve(explicitRoot);

    const candidates = [
      process.env.MEAP_CIRCUITS_DIR,
      path.resolve(process.cwd(), "circuits"),
      path.resolve(process.cwd(), "..", "..", "circuits"),
      path.resolve(__dirname, "../../../../../circuits"),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "UsageBilling.circom"))) {
        return candidate;
      }
    }

    return path.resolve(process.cwd(), "circuits");
  }

  private assertProofTooling(): void {
    if (!fs.existsSync(this.config.proveScriptPath)) {
      throw new UsageProofError(
        UsageProofErrorCodes.TOOLING_UNAVAILABLE,
        `Circuit prover script missing: ${this.config.proveScriptPath}`,
      );
    }
  }

  private assertProofArtifacts(): void {
    const required = [
      this.config.circuitWasmPath,
      this.config.zkeyPath,
      this.config.verificationKeyPath,
    ];
    const missing = required.filter((artifactPath) => !fs.existsSync(artifactPath));
    if (missing.length > 0) {
      throw new UsageProofError(
        UsageProofErrorCodes.ARTIFACTS_MISSING,
        `Missing proof artifact(s): ${missing.join(", ")}`,
      );
    }
    this.assertArtifactVersion();
  }

  private assertArtifactVersion(): void {
    const expectedVersion = this.config.artifactVersion?.trim();
    const manifestPath = this.config.artifactManifestPath;

    if (!fs.existsSync(manifestPath)) {
      if (expectedVersion && this.config.proofMode === "strict") {
        throw new UsageProofError(
          UsageProofErrorCodes.ARTIFACTS_MISSING,
          `Artifact version set (${expectedVersion}) but manifest missing: ${manifestPath}`,
        );
      }
      return;
    }

    let manifestVersion = "";
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw) as { version?: string };
      manifestVersion = String(parsed.version || "").trim();
    } catch (err) {
      throw new UsageProofError(
        UsageProofErrorCodes.ARTIFACTS_MISSING,
        `Invalid artifact manifest JSON: ${manifestPath}`,
        err,
      );
    }

    if (!expectedVersion) return;
    if (!manifestVersion || manifestVersion !== expectedVersion) {
      throw new UsageProofError(
        UsageProofErrorCodes.ARTIFACT_VERSION_MISMATCH,
        `Artifact version mismatch (expected ${expectedVersion}, got ${manifestVersion || "missing"})`,
      );
    }
  }

  private assertVerificationKey(): void {
    try {
      const raw = fs.readFileSync(this.config.verificationKeyPath, "utf8");
      const vkey = JSON.parse(raw) as { protocol?: string; nPublic?: number };
      if (vkey.protocol !== "groth16") {
        throw new Error(`Unsupported protocol: ${String(vkey.protocol || "unknown")}`);
      }
      if (typeof vkey.nPublic === "number" && vkey.nPublic !== 7) {
        throw new Error(`Expected 7 public inputs, received ${vkey.nPublic}`);
      }
    } catch (err) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_VERIFICATION_KEY,
        `Invalid verification key: ${this.config.verificationKeyPath}`,
        err,
      );
    }
  }

  private wrapProofError(err: unknown): UsageProofError {
    if (err instanceof UsageProofError) {
      return err;
    }
    return new UsageProofError(
      UsageProofErrorCodes.PROOF_GENERATION_FAILED,
      "Failed to generate Groth16 proof.",
      err,
    );
  }

  private async loadCircuitProver(): Promise<CircuitProverModule> {
    const moduleUrl = pathToFileURL(this.config.proveScriptPath).href;
    const mod = (await import(moduleUrl)) as CircuitProverModule;
    if (typeof mod.prove !== "function") {
      throw new UsageProofError(
        UsageProofErrorCodes.TOOLING_UNAVAILABLE,
        "Circuit prover module does not export `prove()`.",
      );
    }
    return mod;
  }

  private assertPublicSignals(
    actual: string[],
    aggregation: UsageAggregation,
    agentAddress: string,
    sessionIdBytes32: string,
    prover: CircuitProverModule,
  ): void {
    if (actual.length !== 7) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        `Public signal length mismatch (${actual.length} !== 7).`,
      );
    }

    const expectedAgentField = BigInt(agentAddress).toString();
    const expectedSessionField =
      typeof prover.sessionIdToField === "function"
        ? prover.sessionIdToField(sessionIdBytes32)
        : this.toFieldElement(sessionIdBytes32);

    if (BigInt(actual[0]) !== BigInt(expectedAgentField)) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        "Public signal mismatch at index 0 (agentAddress).",
      );
    }
    if (BigInt(actual[1]) !== BigInt(expectedSessionField)) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        "Public signal mismatch at index 1 (sessionId).",
      );
    }
    if (BigInt(actual[2]) !== BigInt(aggregation.callCount)) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        "Public signal mismatch at index 2 (callCount).",
      );
    }
    if (BigInt(actual[3]) !== BigInt(aggregation.windowStart)) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        "Public signal mismatch at index 3 (windowStart).",
      );
    }
    if (BigInt(actual[4]) !== BigInt(aggregation.windowEnd)) {
      throw new UsageProofError(
        UsageProofErrorCodes.PROOF_SIGNAL_MISMATCH,
        "Public signal mismatch at index 4 (windowEnd).",
      );
    }
  }

  private hashUsageLog(log: UsageLogEntry): `0x${string}` {
    const digest = createHash("sha256")
      .update(JSON.stringify({ ...log.callData, sig: log.signature }))
      .digest("hex");
    return `0x${digest}` as `0x${string}`;
  }

  private normalizeBytes32(value: string): `0x${string}` {
    if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
      return value.toLowerCase() as `0x${string}`;
    }
    const hash = createHash("sha256").update(value).digest("hex");
    return `0x${hash}` as `0x${string}`;
  }

  private addressToBytes32(address: string): `0x${string}` {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_INPUT,
        `Invalid address: ${address}`,
      );
    }
    return `0x${address.slice(2).padStart(64, "0")}`.toLowerCase() as `0x${string}`;
  }

  private fieldToBytes32(field: string): `0x${string}` {
    const value = BigInt(field);
    if (value < 0n || value >= 2n ** 256n) {
      throw new UsageProofError(
        UsageProofErrorCodes.INVALID_INPUT,
        `Field value out of bytes32 range: ${field}`,
      );
    }
    return `0x${value.toString(16).padStart(64, "0")}`.toLowerCase() as `0x${string}`;
  }

  private toFieldElement(input: string | Buffer): string {
    const hex = Buffer.isBuffer(input)
      ? input.toString("hex")
      : input.replace(/^0x/, "");
    const normalized = hex.length === 0 ? "0" : hex;
    const truncated = normalized.slice(0, 62);
    return BigInt(`0x${truncated || "0"}`).toString();
  }
}
