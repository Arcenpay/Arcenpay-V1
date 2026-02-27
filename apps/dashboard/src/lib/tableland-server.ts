import { TablelandService } from "@meap/node/tableland";

let servicePromise: Promise<TablelandService> | null = null;

export function isTablelandConfigured(): boolean {
  return Boolean(process.env.TABLELAND_TABLE_NAME);
}

export async function getTablelandService(): Promise<TablelandService> {
  if (!process.env.TABLELAND_TABLE_NAME) {
    throw new Error(
      "TABLELAND_TABLE_NAME is not configured. Add Tableland env vars to enable feature persistence.",
    );
  }

  if (!servicePromise) {
    const chainId = Number(process.env.TABLELAND_CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);
    const service = new TablelandService({
      tableName: process.env.TABLELAND_TABLE_NAME,
      privateKey: process.env.TABLELAND_PRIVATE_KEY,
      rpcUrl:
        process.env.TABLELAND_RPC_URL ||
        process.env.BASE_SEPOLIA_RPC_URL ||
        process.env.SEPOLIA_RPC_URL,
      chainId,
      gatewayUrl: process.env.TABLELAND_GATEWAY_URL,
    });
    servicePromise = service.initialize().then(() => service);
  }

  return servicePromise;
}
