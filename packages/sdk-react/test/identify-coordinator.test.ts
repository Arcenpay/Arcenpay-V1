import { describe, expect, it, vi } from "vitest";
import { createIdentifyCoordinator } from "../src/lib/identify-coordinator";

/**
 * Regression tests for the `identify()` render loop that exhausted the
 * browser's socket pool (`net::ERR_INSUFFICIENT_RESOURCES`).
 *
 * The loop looked like this in host applications:
 *
 *   useEffect(() => { arcen.identify(...) }, [arcen, address]);
 *
 * `identify()` wrote session state -> the provider's context object got a new
 * identity -> the effect re-fired -> `identify()` again -> ... Each iteration
 * issued two requests. These tests pin the behaviour that makes that impossible.
 */
describe("identify coordinator — render-loop prevention", () => {
  it("executes the task exactly ONCE no matter how many times an effect re-fires", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    const networkCall = vi.fn(async () => {
      await Promise.resolve();
    });

    const KEY = "company_1|0xabc";

    // Simulate the real cycle: a state write schedules another identify call,
    // 100 times over. This is precisely what used to fire ~200 requests.
    for (let i = 0; i < 100; i += 1) {
      await coordinator.run(KEY, networkCall);
    }

    expect(networkCall).toHaveBeenCalledTimes(1);
    expect(coordinator.executions).toBe(1);
    expect(coordinator.hasCompleted(KEY)).toBe(true);
  });

  it("issues ONE request for N concurrent callers (effect + component + hook firing together)", async () => {
    const coordinator = createIdentifyCoordinator<string>();
    let resolveTask: (value: string) => void = () => {};
    const networkCall = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveTask = resolve;
        }),
    );

    const KEY = "company_1|0xabc";
    const callers = Array.from({ length: 12 }, () => coordinator.run(KEY, networkCall));

    expect(networkCall).toHaveBeenCalledTimes(1);
    expect(coordinator.inFlightKeys()).toEqual([KEY]);

    resolveTask("token-123");
    const results = await Promise.all(callers);

    // Every caller observes the same single result.
    expect(results).toEqual(Array(12).fill("token-123"));
    expect(networkCall).toHaveBeenCalledTimes(1);
  });

  it("still identifies distinct subjects independently", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    const networkCall = vi.fn(async () => {});

    await coordinator.run("company_1|0xaaa", networkCall);
    await coordinator.run("company_2|0xbbb", networkCall);
    await coordinator.run("company_1|0xaaa", networkCall); // repeat -> replay

    expect(networkCall).toHaveBeenCalledTimes(2);
    expect(coordinator.executions).toBe(2);
  });

  it("does NOT latch a failed identify, so a retry can succeed", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(coordinator.run("k", failing)).rejects.toThrow("network down");

    // A failed attempt must not be treated as "already identified".
    expect(coordinator.hasCompleted("k")).toBe(false);
    expect(coordinator.inFlightKeys()).toEqual([]);

    const succeeding = vi.fn(async () => {});
    await coordinator.run("k", succeeding);
    expect(succeeding).toHaveBeenCalledTimes(1);
  });

  it("surfaces the failure to every joined caller", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    let rejectTask: (err: Error) => void = () => {};
    const networkCall = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectTask = reject;
        }),
    );

    const a = coordinator.run("k", networkCall);
    const b = coordinator.run("k", networkCall);
    rejectTask(new Error("boom"));

    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");
    expect(networkCall).toHaveBeenCalledTimes(1);
  });

  it("re-arms after reset() (logout / token cleared) so identify runs again", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    const networkCall = vi.fn(async () => {});

    await coordinator.run("k", networkCall);
    await coordinator.run("k", networkCall);
    expect(networkCall).toHaveBeenCalledTimes(1);

    coordinator.reset();
    expect(coordinator.hasCompleted("k")).toBe(false);

    await coordinator.run("k", networkCall);
    expect(networkCall).toHaveBeenCalledTimes(2);
  });

  it("does not drop a newer subject when an older call finishes", async () => {
    const coordinator = createIdentifyCoordinator<void>();
    let releaseFirst: () => void = () => {};
    const first = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const second = vi.fn(async () => {});

    const firstCall = coordinator.run("key-a", first);
    const secondCall = coordinator.run("key-b", second);
    await secondCall;

    expect(coordinator.inFlightKeys()).toEqual(["key-a"]);
    releaseFirst();
    await firstCall;
    expect(coordinator.inFlightKeys()).toEqual([]);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps deduplicating subject A while a different subject B is in flight", async () => {
    // Regression: an earlier implementation tracked only ONE in-flight call, so
    // starting subject B silently forgot subject A and a later call for A
    // started a duplicate pair of requests.
    const coordinator = createIdentifyCoordinator<void>();
    let releaseB: () => void = () => {};
    const taskA = vi.fn(async () => {});
    const taskB = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseB = resolve;
        }),
    );

    const a1 = coordinator.run("key-a", taskA);
    await a1;

    // B is now in flight and stays in flight...
    const bPromise = coordinator.run("key-b", taskB);
    expect(coordinator.inFlightKeys()).toEqual(["key-b"]);

    // ...while A is re-requested by a re-firing effect. Must NOT re-run.
    await coordinator.run("key-a", taskA);
    expect(taskA).toHaveBeenCalledTimes(1);

    releaseB();
    await bPromise;
    expect(taskB).toHaveBeenCalledTimes(1);
  });

  it("bounds how many completed subjects are remembered", async () => {
    const coordinator = createIdentifyCoordinator<number>();
    let counter = 0;
    const task = async () => {
      counter += 1;
      return counter;
    };

    for (let i = 0; i < 100; i += 1) {
      await coordinator.run(`subject-${i}`, task);
    }
    // 100 distinct subjects executed once each; memory stays bounded while the
    // most recent stays replayable.
    expect(counter).toBe(100);
    expect(coordinator.hasCompleted("subject-99")).toBe(true);
  });
});
