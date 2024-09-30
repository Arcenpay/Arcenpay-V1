/**
 * Coordinates `identify()` calls so that a React effect which re-fires cannot
 * produce an unbounded storm of network requests.
 *
 * THE FAILURE THIS PREVENTS
 * -------------------------
 * `identify()` writes React state. The provider's context value is derived from
 * that state, so every write produces a new context object. Consumer code then
 * legitimately does:
 *
 *   useEffect(() => { arcen.identify(...) }, [arcen, address]);
 *
 * which re-runs the moment the context object changes — i.e. immediately after
 * the write `identify` itself caused. That is an unbounded loop, and each
 * iteration used to issue TWO requests (`/events` + `/access-tokens`). Within
 * seconds the browser's socket pool is exhausted and the WHOLE host application
 * starts failing with `net::ERR_INSUFFICIENT_RESOURCES`, including completely
 * unrelated fetch calls.
 *
 * BEHAVIOUR
 * ---------
 * - `run(key, task)` executes `task` at most once per key.
 * - Repeat calls with the same key return the previous result without running
 *   `task` again (no state write, no network).
 * - Concurrent calls with the same key share ONE in-flight promise.
 * - `reset()` re-arms the latch (e.g. when the session token is cleared).
 *
 * Deliberately dependency-free and DOM-free so it can be unit tested directly.
 */
export interface IdentifyCoordinator<TOutput> {
  /** Runs `task` once per key; repeat/concurrent calls reuse the result. */
  run(key: string, task: () => Promise<TOutput>): Promise<TOutput>;
  /** True once `key` has completed successfully. */
  hasCompleted(key: string): boolean;
  /** Re-arms the latch so the next `run` executes `task` again. */
  reset(): void;
  /** Keys currently in flight (more than one when distinct subjects overlap). */
  inFlightKeys(): string[];
  /** How many times a task was actually executed (diagnostics/tests). */
  readonly executions: number;
}

/**
 * Completed results are remembered per key, bounded so a long-lived tab cannot
 * grow the map without limit. Insertion order is preserved by `Map`, so evicting
 * the oldest entry is `keys().next()`.
 */
const MAX_REMEMBERED_SUBJECTS = 32;

export function createIdentifyCoordinator<TOutput>(): IdentifyCoordinator<TOutput> {
  /**
   * In-flight calls, keyed by subject.
   *
   * This MUST be a map rather than a single slot. With a single slot, starting a
   * call for subject B overwrote the record of an in-flight call for subject A,
   * so a later call for A saw "nothing in flight" and started a SECOND identical
   * pair of requests — reintroducing exactly the duplicate-request behaviour
   * this module exists to prevent.
   */
  const inFlight = new Map<string, Promise<TOutput>>();
  const completed = new Map<string, TOutput>();
  let executions = 0;

  function remember(key: string, value: TOutput): void {
    completed.set(key, value);
    while (completed.size > MAX_REMEMBERED_SUBJECTS) {
      const oldest = completed.keys().next();
      if (oldest.done) break;
      completed.delete(oldest.value);
    }
  }

  return {
    async run(key: string, task: () => Promise<TOutput>): Promise<TOutput> {
      // Already done for this subject -> replay the result. This is what makes
      // a re-firing effect harmless.
      if (completed.has(key)) {
        return completed.get(key) as TOutput;
      }

      // Same subject already running -> join it instead of starting a second
      // pair of requests.
      const existing = inFlight.get(key);
      if (existing) {
        return existing;
      }

      executions += 1;
      const promise = (async () => {
        const result = await task();
        remember(key, result);
        return result;
      })();

      inFlight.set(key, promise);
      try {
        return await promise;
      } finally {
        // Only remove OUR entry; another subject's in-flight call must survive.
        if (inFlight.get(key) === promise) {
          inFlight.delete(key);
        }
      }
    },

    hasCompleted(key: string): boolean {
      return completed.has(key);
    },

    reset(): void {
      completed.clear();
      inFlight.clear();
    },

    inFlightKeys(): string[] {
      return [...inFlight.keys()];
    },

    get executions(): number {
      return executions;
    },
  };
}
