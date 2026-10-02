import test from "node:test";
import assert from "node:assert/strict";
import {
  createSubscriptionRouteStore,
  getSubscriptionRouteStateKey,
  resolveRoutingTeamId,
  type SubscriptionRouteStorage,
  type SubscriptionRouteState,
} from "../src/subscription-routing.js";

function createMemoryStorage(
  backingStore = new Map<string, string>(),
): SubscriptionRouteStorage & { backingStore: Map<string, string> } {
  return {
    backingStore,
    async get(key) {
      return backingStore.get(key) ?? null;
    },
    async set(key, value) {
      backingStore.set(key, value);
      return "OK";
    },
    async del(key) {
      backingStore.delete(key);
      return 1;
    },
  };
}

function createRouteState(
  overrides: Partial<SubscriptionRouteState> = {},
): SubscriptionRouteState {
  return {
    wallet: "0xabc",
    teamId: "team-a",
    onChainPlanId: "101",
    updatedAt: new Date(5_000).toISOString(),
    ...overrides,
  };
}

test("keeps token routing isolated per team", async () => {
  const storage = createMemoryStorage();
  const store = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "5042002",
    maxAgeMs: 60_000,
    storage,
    now: () => 10_000,
  });

  await store.write("token-a", createRouteState());
  await store.write(
    "token-b",
    createRouteState({
      wallet: "0xdef",
      teamId: "team-b",
      onChainPlanId: "202",
    }),
  );

  const [teamA, teamB] = await Promise.all([
    resolveRoutingTeamId(
      { sourceTokenId: "token-a" },
      {
        readSubscriptionRouteState: (tokenId) => store.read(tokenId),
        resolvePlanScope: async () => {
          throw new Error("resolver should not be called when token state exists");
        },
      },
    ),
    resolveRoutingTeamId(
      { sourceTokenId: "token-b" },
      {
        readSubscriptionRouteState: (tokenId) => store.read(tokenId),
        resolvePlanScope: async () => {
          throw new Error("resolver should not be called when token state exists");
        },
      },
    ),
  ]);

  assert.equal(teamA, "team-a");
  assert.equal(teamB, "team-b");
});

test("recovers token routing from persisted storage after restart", async () => {
  const storage = createMemoryStorage();
  const firstStore = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "5042002",
    maxAgeMs: 60_000,
    storage,
    now: () => 10_000,
  });

  await firstStore.write(
    "token-restart",
    createRouteState({
      wallet: "0xrestart",
      teamId: "team-restart",
      onChainPlanId: "303",
    }),
  );

  const restartedStore = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "5042002",
    maxAgeMs: 60_000,
    storage,
    now: () => 10_000,
  });

  const recovered = await restartedStore.read("token-restart");

  assert.deepEqual(
    recovered,
    createRouteState({
      wallet: "0xrestart",
      teamId: "team-restart",
      onChainPlanId: "303",
    }),
  );
});

test("evicts stale persisted routing state before it can be reused", async () => {
  const storage = createMemoryStorage();
  const tokenId = "token-stale";
  storage.backingStore.set(
    getSubscriptionRouteStateKey("arcenpay", tokenId, "5042002"),
    JSON.stringify(
      createRouteState({
        teamId: "team-stale",
        updatedAt: new Date(0).toISOString(),
      }),
    ),
  );

  const store = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "5042002",
    maxAgeMs: 1_000,
    storage,
    now: () => 5_000,
  });

  const recovered = await store.read(tokenId);

  assert.equal(recovered, null);
  assert.equal(
    storage.backingStore.has(
      getSubscriptionRouteStateKey("arcenpay", tokenId, "5042002"),
    ),
    false,
  );
});

test("isolates the same tokenId across chains (no cross-chain collision)", async () => {
  // tokenId is per-chain: EVM tokenId=1 and Solana tokenId=1 are DIFFERENT
  // subscriptions. Before chain-scoping, one chain's routing state (and, through
  // it, its billing event) could be suppressed as a duplicate of the other's.
  const storage = createMemoryStorage();
  const evmStore = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "5042002",
    maxAgeMs: 60_000,
    storage,
    now: () => 10_000,
  });
  const solanaStore = createSubscriptionRouteStore({
    keyPrefix: "arcenpay",
    chainId: "9100001",
    maxAgeMs: 60_000,
    storage,
    now: () => 10_000,
  });

  await evmStore.write(
    "1",
    createRouteState({ teamId: "team-evm", wallet: "0xabc" }),
  );
  await solanaStore.write(
    "1",
    createRouteState({ teamId: "team-solana", wallet: "AcarKdAa" }),
  );

  // Distinct storage keys…
  assert.notEqual(
    getSubscriptionRouteStateKey("arcenpay", "1", "5042002"),
    getSubscriptionRouteStateKey("arcenpay", "1", "9100001"),
  );
  // …and each chain reads back its own state.
  assert.equal((await evmStore.read("1"))?.teamId, "team-evm");
  assert.equal((await solanaStore.read("1"))?.teamId, "team-solana");
});

test("falls back to plan resolution when no token routing state exists", async () => {
  const resolvedTeamId = await resolveRoutingTeamId(
    {
      onChainPlanId: "404",
    },
    {
      readSubscriptionRouteState: async () => null,
      resolvePlanScope: async (onChainPlanId) => ({
        teamId: `team-for-${onChainPlanId}`,
        planId: "plan-404",
      }),
    },
  );

  assert.equal(resolvedTeamId, "team-for-404");
});
