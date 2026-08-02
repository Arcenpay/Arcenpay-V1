import { createPublicClient, fallback, http, type Transport, type PublicClient } from "viem";
import { DEFAULT_CHAIN_ID, getChain } from "@arcenpay/internal-core";

export function getFacilitatorRpcTransport(
  rpcUrl?: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Transport {
  const httpOptions = {
    retryCount: 3,
    retryDelay: 1500,
    timeout: 20_000,
  };

  const urls: string[] = [];
  if (rpcUrl) urls.push(rpcUrl);

  const envUrl = process.env[`RPC_URL_${chainId}`] || process.env.RPC_URL;
  if (envUrl) {
    const split = envUrl.split(",").map((s) => s.trim()).filter(Boolean);
    urls.push(...split);
  }

  // Pick ALL chain defaults (not just [0]) so every configured URL participates
  const chainDefaults = getChain(chainId)?.rpcUrls?.default?.http ?? [];
  for (const u of chainDefaults) {
    if (!urls.includes(u)) urls.push(u);
  }

  const uniqueUrls = Array.from(new Set(urls));

  if (uniqueUrls.length > 1) {
    return fallback(
      uniqueUrls.map((url) => http(url, httpOptions)),
      { rank: false, retryCount: 1 },
    );
  }

  if (uniqueUrls.length === 1) {
    return http(uniqueUrls[0], httpOptions);
  }

  return http("", httpOptions);
}

export function createResilientFacilitatorClient(
  rpcUrl?: string,
  chainId: number = DEFAULT_CHAIN_ID,
): PublicClient {
  const chain = getChain(chainId);
  return createPublicClient({
    chain,
    transport: getFacilitatorRpcTransport(rpcUrl, chainId),
  }) as PublicClient;
}
