export type SubscriptionRouteState = {
  wallet: string | null;
  teamId: string | null;
  onChainPlanId: string | null;
  updatedAt: string;
};

export type SubscriptionRouteStorage = {
  get?(key: string): Promise<string | null>;
  set?(key: string, value: string): Promise<unknown>;
  del?(key: string): Promise<unknown>;
};

export type ResolvedPlanScope = {
  teamId: string;
  planId: string | null;
};

type SubscriptionRouteStoreOptions = {
  keyPrefix: string;
  maxAgeMs: number;
  storage?: SubscriptionRouteStorage | null;
  getStorage?: () => SubscriptionRouteStorage | null | undefined;
  cache?: Map<string, SubscriptionRouteState>;
  now?: () => number;
  onWarn?: (message: string, error: unknown) => void;
};

type ResolveRoutingTeamIdInput = {
  teamId?: string | null;
  onChainPlanId?: string | null;
  sourceTokenId?: string;
};

type ResolveRoutingTeamIdDependencies = {
  readSubscriptionRouteState: (
    tokenId: string,
  ) => Promise<SubscriptionRouteState | null>;
  resolvePlanScope: (
    onChainPlanId: string,
  ) => Promise<ResolvedPlanScope | null>;
};

function normalizeNonEmptyString(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isSubscriptionRouteStateFresh(
  state: SubscriptionRouteState,
  now: number,
  maxAgeMs: number,
): boolean {
  const updatedAtMs = Date.parse(state.updatedAt);
  return Number.isFinite(updatedAtMs) && now - updatedAtMs <= maxAgeMs;
}

export function getSubscriptionRouteStateKey(
  keyPrefix: string,
  tokenId: string,
): string {
  return `${keyPrefix}:subscription-route:${tokenId}`;
}

export function createSubscriptionRouteStore(
  options: SubscriptionRouteStoreOptions,
) {
  const cache = options.cache ?? new Map<string, SubscriptionRouteState>();
  const now = options.now ?? (() => Date.now());
  const onWarn = options.onWarn ?? (() => undefined);

  function getStorage(): SubscriptionRouteStorage | null | undefined {
    return options.getStorage?.() ?? options.storage;
  }

  async function removePersistedState(tokenId: string): Promise<void> {
    const storage = getStorage();
    if (!storage?.del) return;

    try {
      await storage.del(getSubscriptionRouteStateKey(options.keyPrefix, tokenId));
    } catch (error) {
      onWarn(
        `Failed deleting subscription routing state for token ${tokenId}`,
        error,
      );
    }
  }

  return {
    async read(tokenId: string): Promise<SubscriptionRouteState | null> {
      const cached = cache.get(tokenId);
      if (cached) {
        if (
          isSubscriptionRouteStateFresh(cached, now(), options.maxAgeMs)
        ) {
          return cached;
        }
        cache.delete(tokenId);
      }

      const storage = getStorage();
      if (!storage?.get) return null;

      try {
        const raw = await storage.get(
          getSubscriptionRouteStateKey(options.keyPrefix, tokenId),
        );
        if (!raw) return null;

        const parsed = JSON.parse(raw) as SubscriptionRouteState;
        if (
          !isSubscriptionRouteStateFresh(parsed, now(), options.maxAgeMs)
        ) {
          cache.delete(tokenId);
          await removePersistedState(tokenId);
          return null;
        }

        cache.set(tokenId, parsed);
        return parsed;
      } catch (error) {
        onWarn(
          `Failed reading subscription routing state for token ${tokenId}`,
          error,
        );
        return null;
      }
    },

    async write(
      tokenId: string,
      nextState: SubscriptionRouteState,
    ): Promise<void> {
      cache.set(tokenId, nextState);

      const storage = getStorage();
      if (!storage?.set) return;

      try {
        await storage.set(
          getSubscriptionRouteStateKey(options.keyPrefix, tokenId),
          JSON.stringify(nextState),
        );
      } catch (error) {
        onWarn(
          `Failed persisting subscription routing state for token ${tokenId}`,
          error,
        );
      }
    },

    async remove(tokenId: string): Promise<void> {
      cache.delete(tokenId);
      await removePersistedState(tokenId);
    },
  };
}

export async function resolveRoutingTeamId(
  input: ResolveRoutingTeamIdInput,
  dependencies: ResolveRoutingTeamIdDependencies,
): Promise<string | null> {
  const explicitTeamId = normalizeNonEmptyString(input.teamId);
  if (explicitTeamId) {
    return explicitTeamId;
  }

  if (input.sourceTokenId) {
    const state = await dependencies.readSubscriptionRouteState(
      input.sourceTokenId,
    );
    const storedTeamId = normalizeNonEmptyString(state?.teamId);
    if (storedTeamId) return storedTeamId;
  }

  const onChainPlanId = normalizeNonEmptyString(input.onChainPlanId);
  if (!onChainPlanId) return null;

  const planScope = await dependencies.resolvePlanScope(onChainPlanId);
  return normalizeNonEmptyString(planScope?.teamId);
}
