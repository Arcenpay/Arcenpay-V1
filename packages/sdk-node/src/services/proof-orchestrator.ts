// ============================================================
//  @meap/node — Proof Submission Orchestrator
//  Ties usage aggregation → proof generation → on-chain submission
//  with deterministic retry, idempotency, and nullifier tracking.
// ============================================================

import { createHash } from "crypto";
import { UsageService, type UsageServiceConfig } from "./usage";

// ============================================================
//  Types
// ============================================================

export interface ProofOrchestratorConfig extends UsageServiceConfig {
  /** Max retries for proof submission (default: 3) */
  maxRetries?: number;
  /** Backoff delays in ms between retries (default: [2000, 5000, 15000]) */
  retryDelays?: number[];
  /** Auto-submit threshold: generate + submit proof when a session reaches this many calls */
  autoSubmitThreshold?: number;
  /** Settlement window duration in seconds (default: 3600 = 1 hour) */
  windowDurationSeconds?: number;
}

type ProofStatus =
  | "pending"
  | "generating"
  | "submitting"
  | "settled"
  | "failed";

interface ProofJob {
  sessionId: string;
  windowEnd: number;
  status: ProofStatus;
  attempts: number;
  nullifier: string | null;
  txHash: string | null;
  error: string | null;
  createdAt: number;
  lastAttemptAt: number;
}

// ============================================================
//  Orchestrator
// ============================================================

/**
 * ProofOrchestrator coordinates the full ZKVUB settlement pipeline:
 *
 * 1. Monitor usage aggregation counts per session
 * 2. When threshold is reached, freeze window and generate proof
 * 3. Submit proof on-chain with deterministic retry
 * 4. Track nullifiers to prevent double-settlement
 * 5. Clean up after successful settlement
 */
export class ProofOrchestrator {
  private readonly usageService: UsageService;
  private readonly config: Required<
    Pick<
      ProofOrchestratorConfig,
      | "maxRetries"
      | "retryDelays"
      | "autoSubmitThreshold"
      | "windowDurationSeconds"
    >
  >;

  /**
   * Nullifiers that have been submitted — prevents double-settlement.
   * Key: nullifier hash, Value: settlement timestamp
   */
  private readonly settledNullifiers = new Map<string, number>();

  /** Active proof jobs indexed by `sessionId:windowEnd` */
  private readonly activeJobs = new Map<string, ProofJob>();

  /** Completed job history (last 200) */
  private readonly jobHistory: ProofJob[] = [];

  /** Interval for auto-submit checks */
  private autoCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ProofOrchestratorConfig = {}) {
    this.usageService = new UsageService(config);
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      retryDelays: config.retryDelays ?? [2_000, 5_000, 15_000],
      autoSubmitThreshold: config.autoSubmitThreshold ?? 50,
      windowDurationSeconds: config.windowDurationSeconds ?? 3600,
    };
  }

  /**
   * Records usage and auto-triggers proof+submission when threshold is reached
   */
  async recordUsage(
    sessionId: string,
    callData: {
      endpoint: string;
      method: string;
      timestamp: number;
      responseSize?: number;
    },
  ): Promise<void> {
    await this.usageService.logUsage(sessionId, callData);

    const count = this.usageService.getUsageCount(sessionId);
    if (count >= this.config.autoSubmitThreshold) {
      // Fire-and-forget — don't block the usage logging path
      void this.generateAndSubmit(sessionId).catch((err) =>
        console.error(
          `[ProofOrchestrator] Auto-submit failed for ${sessionId}:`,
          err,
        ),
      );
    }
  }

  /**
   * Manually triggers proof generation + submission for a session
   */
  async generateAndSubmit(sessionId: string): Promise<ProofJob> {
    const windowEnd = Math.floor(Date.now() / 1000);
    const jobKey = `${sessionId}:${windowEnd}`;

    // Idempotency — return existing job if already running
    const existingJob = this.activeJobs.get(jobKey);
    if (existingJob && existingJob.status !== "failed") {
      return existingJob;
    }

    const job: ProofJob = {
      sessionId,
      windowEnd,
      status: "pending",
      attempts: 0,
      nullifier: null,
      txHash: null,
      error: null,
      createdAt: Date.now(),
      lastAttemptAt: 0,
    };

    this.activeJobs.set(jobKey, job);
    return this.executeJob(job);
  }

  /**
   * Execute a proof job with deterministic retry
   */
  private async executeJob(job: ProofJob): Promise<ProofJob> {
    const jobKey = `${job.sessionId}:${job.windowEnd}`;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      job.attempts = attempt + 1;
      job.lastAttemptAt = Date.now();

      // Backoff delay (skip on first attempt)
      if (attempt > 0) {
        const delay = this.config.retryDelays[attempt - 1] ?? 15_000;
        console.log(
          `[ProofOrchestrator] Retry ${attempt}/${this.config.maxRetries} in ${delay}ms for ${job.sessionId}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        // Step 1: Generate proof
        job.status = "generating";
        const { proof, publicInputs } = await this.usageService.generateProof(
          job.sessionId,
          job.windowEnd,
        );

        // Step 2: Nullifier deduplication check
        const nullifierKey = publicInputs.nullifier;
        if (this.settledNullifiers.has(nullifierKey)) {
          console.warn(
            `[ProofOrchestrator] Nullifier already settled: ${nullifierKey}`,
          );
          job.status = "settled";
          job.nullifier = nullifierKey;
          job.error = "Nullifier already settled (idempotent skip)";
          this.archiveJob(jobKey, job);
          return job;
        }

        // Step 3: Submit proof on-chain
        job.status = "submitting";
        const settlement = await this.usageService.submitProof(
          proof,
          publicInputs,
        );

        // Step 4: Record success
        job.status = "settled";
        job.nullifier = nullifierKey;
        job.txHash = settlement.transactionHash;
        job.error = null;

        // Track nullifier
        this.settledNullifiers.set(nullifierKey, Date.now());

        // Clear settled logs
        this.usageService.clearLogs(job.sessionId, job.windowEnd);

        console.log(
          `[ProofOrchestrator] ✅ Settled ${job.sessionId} → ${settlement.transactionHash}`,
        );
        this.archiveJob(jobKey, job);
        return job;
      } catch (err: any) {
        job.error = err?.message || String(err);
        job.status = "failed";
        console.error(
          `[ProofOrchestrator] Attempt ${attempt + 1} failed for ${job.sessionId}:`,
          err?.message,
        );
      }
    }

    // All retries exhausted
    console.error(
      `[ProofOrchestrator] ❌ All ${this.config.maxRetries + 1} attempts failed for ${job.sessionId}`,
    );
    this.archiveJob(jobKey, job);
    return job;
  }

  /**
   * Move a job from active to history
   */
  private archiveJob(jobKey: string, job: ProofJob): void {
    this.activeJobs.delete(jobKey);
    this.jobHistory.push({ ...job });
    if (this.jobHistory.length > 200) {
      this.jobHistory.splice(0, this.jobHistory.length - 200);
    }
  }

  /**
   * Start auto-submit monitoring (polls every 30s)
   */
  startAutoSubmit(): void {
    if (this.autoCheckInterval) return;
    console.log(
      `[ProofOrchestrator] Auto-submit started (threshold: ${this.config.autoSubmitThreshold} calls)`,
    );
    this.autoCheckInterval = setInterval(async () => {
      try {
        const sessions = this.usageService.getAllSessions();
        for (const sessionId of sessions) {
          const count = this.usageService.getUsageCount(sessionId);
          if (count >= this.config.autoSubmitThreshold) {
            const jobKey = Array.from(this.activeJobs.keys()).find((k) =>
              k.startsWith(`${sessionId}:`),
            );
            if (!jobKey) {
              console.log(
                `[ProofOrchestrator] Auto-submit triggered for ${sessionId} (${count} calls)`,
              );
              void this.generateAndSubmit(sessionId).catch((err) =>
                console.error(
                  `[ProofOrchestrator] Auto-submit failed for ${sessionId}:`,
                  err,
                ),
              );
            }
          }
        }
      } catch (err) {
        console.error("[ProofOrchestrator] Auto-submit poll error:", err);
      }
    }, 30_000);
    if (
      typeof this.autoCheckInterval === "object" &&
      "unref" in this.autoCheckInterval
    ) {
      this.autoCheckInterval.unref();
    }
  }

  /**
   * Stop auto-submit monitoring
   */
  stop(): void {
    if (this.autoCheckInterval) {
      clearInterval(this.autoCheckInterval);
      this.autoCheckInterval = null;
    }
  }

  /**
   * Get current active proof jobs
   */
  getActiveJobs(): ProofJob[] {
    return Array.from(this.activeJobs.values());
  }

  /**
   * Get completed job history
   */
  getJobHistory(limit = 50): ProofJob[] {
    return this.jobHistory.slice(-limit).reverse();
  }

  /**
   * Check if a nullifier has already been settled
   */
  isNullifierSettled(nullifier: string): boolean {
    return this.settledNullifiers.has(nullifier);
  }

  /**
   * Get the underlying UsageService for direct access
   */
  getUsageService(): UsageService {
    return this.usageService;
  }
}
