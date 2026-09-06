import { createPublicClient, fallback, http, type Transport, type PublicClient } from "viem";
import {
  DEFAULT_CHAIN_ID,
  getChain,
  getChainFamily,
} from "@arcenpay/internal-core";

// EVM-only stub returned for non-EVM chains so that services which lazily hold
// a viem client (proof orchestrator, usage, settlement, listeners) don't crash
// at construction time on a Stellar chain. Any method invoked on it is a bug —
// Stellar paths must use the StellarChainAdapter instead.
function createNoopClient(): PublicClient {
  return new Proxy({} as PublicClient, {
    get: (_target, prop) => {
      if (typeof prop === "string" && ["then", "catch", "toString", "inspect", Symbol.toPrimitive].includes(prop))
        return undefined;
      throw new Error(
        "EVM client used on a non-EVM (Stellar) chain. Stellar on-chain reads must go through StellarChainAdapter.",
      );
    },
  });
}

export function getFacilitatorRpcTransport(
  rpcUrl?: string,
  chainId: number = DEFAULT_CHAIN_ID,
): Transport {
  // Stellar/Horizon URLs aren't viem transports. Return a no-op transport so
  // createResilientFacilitatorClient can still hand back a stub client.
  if (getChainFamily(chainId) === "stellar") return http("", { timeout: 1000 });

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
  const chain = getChain(chainId);
  const chainDefaults = chain?.rpcUrls?.default?.http ?? [];
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
  if (getChainFamily(chainId) === "stellar") return createNoopClient();
  const chain = getChain(chainId);
  return createPublicClient({
    chain,
    transport: getFacilitatorRpcTransport(rpcUrl, chainId),
  }) as PublicClient;
}
