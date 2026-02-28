interface FeatureFlagStore {
  listTierFeatureFlags(
    providerAddress: string,
    tiers: string[],
  ): Promise<Record<string, Record<string, boolean | string | number>>>;
  setTierFeatureFlags(
    providerAddress: string,
    tier: string,
    flags: Record<string, boolean | string | number>,
  ): Promise<boolean>;
}

let servicePromise: Promise<FeatureFlagStore> | null = null;

export function isTablelandConfigured(): boolean {
  return Boolean(process.env.TABLELAND_TABLE_NAME);
}

export async function getTablelandService(): Promise<FeatureFlagStore> {
  if (!process.env.TABLELAND_TABLE_NAME) {
    throw new Error(
      "TABLELAND_TABLE_NAME is not configured. Add Tableland env vars to enable feature persistence.",
    );
  }

  if (!servicePromise) {
    servicePromise = (async () => {
      const moduleName = ["@meap", "node", "tableland"].join("/");
      let TablelandServiceCtor: new (config: Record<string, unknown>) => {
        initialize: () => Promise<void>;
      } & FeatureFlagStore;

      try {
        const tablelandModule = (await import(moduleName)) as {
          TablelandService: typeof TablelandServiceCtor;
        };
        TablelandServiceCtor = tablelandModule.TablelandService;
      } catch (error) {
        throw new Error(
          `Tableland SDK is unavailable in this runtime. Install optional dependencies for @meap/node. ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const chainId = Number(
        process.env.TABLELAND_CHAIN_ID ||
          process.env.NEXT_PUBLIC_CHAIN_ID ||
          11155111,
      );
      const service = new TablelandServiceCtor({
        tableName: process.env.TABLELAND_TABLE_NAME,
        privateKey: process.env.TABLELAND_PRIVATE_KEY,
        rpcUrl:
          process.env.TABLELAND_RPC_URL ||
          process.env.BASE_SEPOLIA_RPC_URL ||
          process.env.SEPOLIA_RPC_URL,
        chainId,
        gatewayUrl: process.env.TABLELAND_GATEWAY_URL,
      });
      await service.initialize();
      return service;
    })();
  }

  return servicePromise;
}
