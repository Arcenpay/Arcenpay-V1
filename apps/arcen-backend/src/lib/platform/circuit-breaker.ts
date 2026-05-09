/**
 * Lightweight circuit breaker for external service calls.
 *
 * Prevents cascading failures when a downstream service (RPC, Redis, Subgraph,
 * Tableland, Lit) is degraded. After `failureThreshold` consecutive failures
 * within `windowMs`, the circuit opens and fast-fails all calls for `resetTimeoutMs`.
 *
 * Usage:
 *   const rpcBreaker = new CircuitBreaker({ name: "rpc-base-sepolia", failureThreshold: 5 });
 *   const result = await rpcBreaker.call(() => publicClient.readContract(...));
 */

interface CircuitBreakerOptions {
  /** Name for logging/monitoring. */
  name: string;
  /** Consecutive failures to trip the circuit. Default: 5. */
  failureThreshold?: number;
  /** Duration (ms) the circuit stays open before trying half-open. Default: 30_000. */
  resetTimeoutMs?: number;
  /** Sliding window (ms) for counting failures. Default: 60_000. */
  windowMs?: number;
  /** Called when the circuit trips. */
  onOpen?: (name: string) => void;
  /** Called when the circuit closes (recovers). */
  onClose?: (name: string) => void;
}

type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  readonly name: string;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly windowMs: number;
  private readonly onOpen?: (name: string) => void;
  private readonly onClose?: (name: string) => void;

  private state: CircuitState = "closed";
  private failures: number[] = []; // timestamps of failures
  private openedAt = 0;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.windowMs = options.windowMs ?? 60_000;
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
  }

  /** Execute an async call with circuit breaker protection. */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === "open") {
      if (Date.now() - this.openedAt >= this.resetTimeoutMs) {
        this.state = "half-open";
      } else {
        throw new CircuitOpenError(this.name, this.openedAt + this.resetTimeoutMs);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    if (this.state === "half-open") {
      this.state = "closed";
      this.failures = [];
      this.onClose?.(this.name);
    }
    // In closed state, successes don't reset the counter
    // — only time-based window expiry removes old failures
  }

  private onFailure() {
    const now = Date.now();
    // Prune stale failures
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);

    if (this.failures.length >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = now;
      this.onOpen?.(this.name);
    }
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  get failureCount(): number {
    return this.failures.length;
  }
}

export class CircuitOpenError extends Error {
  readonly retryAfter: number;

  constructor(circuitName: string, retryAt: number) {
    super(`Circuit "${circuitName}" is open — retry after ${new Date(retryAt).toISOString()}`);
    this.name = "CircuitOpenError";
    this.retryAfter = retryAt;
  }
}
