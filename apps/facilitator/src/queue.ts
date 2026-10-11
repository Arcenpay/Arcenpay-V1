// ============================================================
//  ArcenPay Facilitator — Durable Job Queue
//
//  Provides Redis-backed job queues with:
//  - Idempotency deduplication (per key, TTL'd)
//  - Exponential backoff retry (5s → 30s → 5min → 30min)
//  - Dead-letter queue for permanently failed jobs
//  - Optional Redis persistence for crash recovery
//  - Prometheus-compatible stats surface
//
//  Falls back gracefully to in-memory when Redis is not
//  available, preserving the retry/dead-letter semantics.
// ============================================================

import { randomBytes } from "crypto";

// Minimal Redis interface — only the methods DurableJobQueue needs.
// Compatible with ioredis v4/v5 without a direct import dependency.
export interface IRedisQueue {
  rpush(key: string, ...values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del(key: string): Promise<number>;
}

export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead";

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  idempotencyKey?: string;
  attempts: number;
  maxRetries: number;
  lastError?: string;
  nextRetryAt: number;
  createdAt: number;
  processedAt?: number;
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>;

// Retry delays: 5s, 30s, 5min, 30min (with ±20% jitter)
const RETRY_DELAYS_MS = [5_000, 30_000, 300_000, 1_800_000];

function retryDelayFor(attempt: number): number {
  const base = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  return base + Math.floor(Math.random() * base * 0.2);
}

interface QueueState<T = unknown> {
  pending: Job<T>[];
  deadLetter: Job<T>[];
  // idempotencyKey → expiresAt (ms)
  seenIdempotencyKeys: Map<string, number>;
}

export interface QueueStats {
  pending: number;
  deadLetter: number;
  seenIdempotencyKeys: number;
}

export class DurableJobQueue {
  private queues = new Map<string, QueueState>();
  private workers = new Map<string, ReturnType<typeof setInterval>>();
  private redis: IRedisQueue | null = null;
  private keyPrefix: string;

  // Key TTL for idempotency dedup (1 hour)
  private static readonly IDEMPOTENCY_TTL_MS = 3_600_000;

  constructor(options?: { redis?: IRedisQueue; keyPrefix?: string }) {
    this.redis = options?.redis ?? null;
    this.keyPrefix = options?.keyPrefix ?? "arcenpay:queue";
  }

  /** Attach or replace the Redis client (e.g. after async connection). */
  setRedis(client: IRedisQueue): void {
    this.redis = client;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private getOrCreate(name: string): QueueState {
    if (!this.queues.has(name)) {
      this.queues.set(name, {
        pending: [],
        deadLetter: [],
        seenIdempotencyKeys: new Map(),
      });
    }
    return this.queues.get(name)!;
  }

  private async redisPersist(
    queueName: string,
    zone: "pending" | "dead",
    job: Job,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.rpush(
        `${this.keyPrefix}:${queueName}:${zone}`,
        JSON.stringify(job),
      );
    } catch {
      // Redis write failure is non-fatal — job lives in memory
    }
  }

  // ── Crash recovery ────────────────────────────────────────────────────────

  /**
   * Loads any jobs left in Redis pending lists from a previous crash.
   * Call once after Redis connects, before starting workers.
   */
  async recoverFromRedis(queueName: string): Promise<number> {
    if (!this.redis) return 0;
    const key = `${this.keyPrefix}:${queueName}:pending`;
    try {
      const raw = await this.redis.lrange(key, 0, -1);
      if (raw.length === 0) return 0;

      const queue = this.getOrCreate(queueName);
      let recovered = 0;

      for (const item of raw) {
        try {
          const job = JSON.parse(item) as Job;
          // Reset nextRetryAt to now so they process immediately
          job.nextRetryAt = Date.now();
          queue.pending.push(job);
          recovered++;
        } catch {
          // Corrupt entry — skip
        }
      }

      // Clear the Redis list (it's now in memory)
      await this.redis.del(key);
      console.log(
        `[Queue:${queueName}] Recovered ${recovered} jobs from Redis crash recovery`,
      );
      return recovered;
    } catch {
      return 0;
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Adds a job to the queue. Deduplicates by idempotencyKey if provided.
   * Returns the job ID (same as idempotencyKey if provided).
   */
  async enqueue<T>(
    queueName: string,
    type: string,
    payload: T,
    options?: { idempotencyKey?: string; maxRetries?: number },
  ): Promise<string> {
    const queue = this.getOrCreate(queueName);
    const idempotencyKey = options?.idempotencyKey;
    const now = Date.now();

    // Idempotency deduplication
    if (idempotencyKey) {
      const exp = queue.seenIdempotencyKeys.get(idempotencyKey);
      if (exp !== undefined && now < exp) {
        // Already queued and TTL not expired — skip
        return idempotencyKey;
      }
    }

    const id = idempotencyKey ?? randomBytes(8).toString("hex");

    const job: Job<T> = {
      id,
      type,
      payload,
      idempotencyKey,
      attempts: 0,
      maxRetries: options?.maxRetries ?? 4,
      nextRetryAt: now,
      createdAt: now,
    };

    if (idempotencyKey) {
      queue.seenIdempotencyKeys.set(
        idempotencyKey,
        now + DurableJobQueue.IDEMPOTENCY_TTL_MS,
      );

      // The dedup map is only pruned lazily on lookup, so a long-running
      // process processing distinct keys would grow it without bound. Sweep
      // expired entries once it crosses a threshold.
      if (queue.seenIdempotencyKeys.size > 10_000) {
        for (const [key, expiresAt] of queue.seenIdempotencyKeys) {
          if (now >= expiresAt) queue.seenIdempotencyKeys.delete(key);
        }
      }
    }

    queue.pending.push(job as Job<unknown>);

    // Persist to Redis for crash durability
    await this.redisPersist(queueName, "pending", job as Job);

    return id;
  }

  /**
   * Starts a polling worker for the given queue.
   * Only one worker per queue name — calling twice is a no-op.
   */
  startWorker<T>(
    queueName: string,
    handler: JobHandler<T>,
    options?: { pollIntervalMs?: number; concurrency?: number },
  ): void {
    if (this.workers.has(queueName)) return;

    const pollMs = options?.pollIntervalMs ?? 1_000;
    // Bounded concurrency. The previous implementation dequeued ONE job per
    // tick and, because `setInterval` does not await the handler, could start an
    // unbounded number of overlapping runs on slow ticks. This drains up to
    // `concurrency` jobs concurrently and never exceeds it, so a burst (e.g. a
    // renewal wave) drains quickly without unbounded fan-out.
    // INVARIANT: QUEUE_CONCURRENCY x activeWorkers <= DB_POOL_MAX.
    //
    // These jobs land on the backend, which holds the ONLY database pool in the
    // system (the facilitator opens no DB connections itself). The previous
    // default of 10 was sized as if one worker existed, so two chain processes
    // pushed 20 concurrent requests at a 10-connection pool — which is what
    // exhausted Postgres. Keep this small; scale throughput by raising
    // DB_POOL_MAX and the database plan, not by fanning out here.
    const concurrency = Math.max(
      1,
      options?.concurrency ??
        Number(process.env.QUEUE_CONCURRENCY || 3),
    );
    let inFlight = 0;

    const interval = setInterval(() => {
      const queue = this.getOrCreate(queueName);
      let capacity = concurrency - inFlight;
      if (capacity <= 0) return;

      const now = Date.now();

      // Single-pass partition: take up to `capacity` ready jobs, keep the rest
      // in order. The previous `findIndex` + `splice` per job was O(n) per
      // dequeue — O(n²) to drain a large backlog. This is O(n) per tick.
      const ready: Array<Job<T>> = [];
      const remaining: Array<Job<unknown>> = [];
      for (const job of queue.pending as Array<Job<T>>) {
        if (capacity > 0 && job.nextRetryAt <= now) {
          ready.push(job);
          capacity -= 1;
        } else {
          remaining.push(job as Job<unknown>);
        }
      }
      queue.pending = remaining;

      for (const job of ready) {
        job.attempts += 1;
        job.processedAt = now;
        inFlight += 1;

        void (async () => {
          try {
            await handler(job);

            // Success — extend idempotency TTL so a late duplicate is dropped
            if (job.idempotencyKey) {
              queue.seenIdempotencyKeys.set(
                job.idempotencyKey,
                Date.now() + DurableJobQueue.IDEMPOTENCY_TTL_MS,
              );
            }
          } catch (err) {
            job.lastError = err instanceof Error ? err.message : String(err);

            if (job.attempts >= job.maxRetries) {
              // Dead-letter
              (queue as QueueState<unknown>).deadLetter.push(job as Job<unknown>);
              console.error(
                `[Queue:${queueName}] Job ${job.id} dead-lettered after ${job.attempts} attempts: ${job.lastError}`,
              );
              await this.redisPersist(queueName, "dead", job as Job);
            } else {
              // Re-queue with exponential backoff
              const delay = retryDelayFor(job.attempts);
              job.nextRetryAt = Date.now() + delay;
              (queue as QueueState<unknown>).pending.push(job as Job<unknown>);
              console.warn(
                `[Queue:${queueName}] Job ${job.id} retry ${job.attempts}/${job.maxRetries} ` +
                  `in ${(delay / 1000).toFixed(0)}s: ${job.lastError}`,
              );
            }
          } finally {
            inFlight -= 1;
          }
        })();
      }
    }, pollMs);

    // Prevent worker interval from blocking process exit
    if (interval.unref) interval.unref();

    this.workers.set(queueName, interval);
  }

  /**
   * Returns queue statistics (pending depth, dead-letter count).
   */
  getStats(queueName: string): QueueStats {
    const q = this.queues.get(queueName);
    if (!q) return { pending: 0, deadLetter: 0, seenIdempotencyKeys: 0 };
    return {
      pending: q.pending.length,
      deadLetter: q.deadLetter.length,
      seenIdempotencyKeys: q.seenIdempotencyKeys.size,
    };
  }

  /**
   * Returns all jobs in the dead-letter queue for the given queue name.
   */
  getDeadLetterJobs(queueName: string): Job[] {
    return [...(this.queues.get(queueName)?.deadLetter ?? [])];
  }

  /**
   * Re-enqueues a dead-letter job by ID for retry.
   * Returns true if the job was found and re-queued.
   */
  replayDeadLetterJob(queueName: string, jobId: string): boolean {
    const queue = this.queues.get(queueName);
    if (!queue) return false;

    const idx = queue.deadLetter.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;

    const job = queue.deadLetter.splice(idx, 1)[0];
    job.attempts = 0;
    job.lastError = undefined;
    job.nextRetryAt = Date.now();
    queue.pending.push(job);
    return true;
  }

  /**
   * Re-enqueues ALL dead-letter jobs for a given queue.
   * Returns the count of jobs re-queued.
   */
  replayAllDeadLetter(queueName: string): number {
    const queue = this.queues.get(queueName);
    if (!queue || queue.deadLetter.length === 0) return 0;

    const count = queue.deadLetter.length;
    for (const job of queue.deadLetter) {
      job.attempts = 0;
      job.lastError = undefined;
      job.nextRetryAt = Date.now();
      queue.pending.push(job);
    }
    queue.deadLetter = [];
    return count;
  }

  /**
   * Stops all workers. Call on graceful shutdown.
   */
  stop(): void {
    for (const interval of this.workers.values()) {
      clearInterval(interval);
    }
    this.workers.clear();
  }
}
