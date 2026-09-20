/**
 * GET /api/v1/public/smart-account-config
 *
 * Returns bundler & paymaster URLs for the hosted smart-account provider
 * configured for the requested chain.
 */
import type { Context } from "hono";
import { PIMLICO_API_KEY, PIMLICO_RPC_URL } from "../../../config.js";
import { DEFAULT_CHAIN_ID } from "../../../lib/platform/default-chain.js";
import { corsHeaders } from "../../../middleware/cors.js";

function readTrimmedEnv(name: string) {
  return (process.env[name] ?? "").trim();
}

function getPimlicoApiKey(chainId: number) {
  return (
    (
      readTrimmedEnv(`PIMLICO_API_KEY_${chainId}`) ||
      readTrimmedEnv(`NEXT_PUBLIC_PIMLICO_API_KEY_${chainId}`) ||
      PIMLICO_API_KEY
    )?.trim() ?? ""
  );
}

function getSharedPimlicoRpcOverride(chainId: number) {
  return (
    readTrimmedEnv(`PAYMASTER_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`BUNDLER_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`PIMLICO_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`PIMLICO_RPC_${chainId}`) ||
    readTrimmedEnv(`NEXT_PUBLIC_PIMLICO_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`NEXT_PUBLIC_PIMLICO_RPC_${chainId}`) ||
    readTrimmedEnv("BUNDLER_RPC_URL") ||
    readTrimmedEnv("PIMLICO_RPC_URL") ||
    readTrimmedEnv("PAYMASTER_RPC_URL") ||
    PIMLICO_RPC_URL ||
    ""
  ).trim();
}

function getBundlerUrl(chainId: number) {
  const explicitUrl =
    readTrimmedEnv(`BUNDLER_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`PIMLICO_BUNDLER_RPC_URL_${chainId}`) ||
    readTrimmedEnv("BUNDLER_RPC_URL") ||
    readTrimmedEnv("PIMLICO_BUNDLER_RPC_URL") ||
    getSharedPimlicoRpcOverride(chainId);

  if (explicitUrl) {
    return explicitUrl;
  }

  const apiKey = getPimlicoApiKey(chainId);
  if (!apiKey) {
    return "";
  }

  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}

function getPaymasterUrl(chainId: number) {
  const explicitUrl =
    readTrimmedEnv(`PAYMASTER_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`PIMLICO_PAYMASTER_RPC_URL_${chainId}`) ||
    readTrimmedEnv("PAYMASTER_RPC_URL") ||
    readTrimmedEnv("PIMLICO_PAYMASTER_RPC_URL") ||
    getSharedPimlicoRpcOverride(chainId);

  if (explicitUrl) {
    return explicitUrl;
  }

  const apiKey = getPimlicoApiKey(chainId);
  if (!apiKey) {
    return "";
  }

  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}

/**
 * Chains the hosted provider (Pimlico) actually supports.
 *
 * `getBundlerUrl()`/`getPaymasterUrl()` synthesise
 * `https://api.pimlico.io/v2/<chainId>/rpc?apikey=…` for ANY chain id whenever a
 * key is present. For a chain Pimlico does not serve — 677 (BOT Chain Mainnet)
 * and 968 (BOT Chain Testnet/BOHR) are not in its supported list — the client
 * receives a URL that fails on first use:
 *
 *   pimlico_getUserOperationGasPrice → chain "677" is not supported
 *
 * Returning empty URLs for those chains (unless the operator has explicitly
 * configured their OWN bundler, which we cannot judge) lets the SDK fall through
 * to a direct wallet transaction where the user pays gas.
 *
 * Source: https://docs.pimlico.io/guides/supported-chains
 */
const HOSTED_PROVIDER_SUPPORTED_CHAIN_IDS: ReadonlySet<number> = new Set([
  1, // Ethereum
  11155111, // Ethereum Sepolia
  8453, // Base
  84532, // Base Sepolia
  137, // Polygon
  42161, // Arbitrum One
  10, // Optimism
  5042, // Arc Mainnet
  5042002, // Arc Testnet
]);

function isPimlicoEndpoint(url: string): boolean {
  return /api\.pimlico\.io\//i.test(url);
}

export async function OPTIONS(c: Context) {
  return c.json(null, 204 as any, corsHeaders(c.req.header("origin")));
}

export async function GET(c: Context) {
  const origin = c.req.header("origin");
  const chainIdRaw = c.req.query("chainId");
  const requestedSelfFunded = c.req.query("selfFunded") === "true";
  const chainId = chainIdRaw
    ? Number.parseInt(chainIdRaw, 10)
    : DEFAULT_CHAIN_ID;

  if (!Number.isFinite(chainId) || chainId <= 0) {
    return c.json({ error: "Invalid chainId" }, 400, corsHeaders(origin));
  }

  const bundlerUrl = getBundlerUrl(chainId);
  const paymasterUrl = getPaymasterUrl(chainId);
  if (!bundlerUrl || !paymasterUrl) {
    return c.json(
      {
        error:
          "No smart-account provider is configured on the backend. Set Pimlico environment variables first.",
      },
      503,
      corsHeaders(origin),
    );
  }

  /**
   * Refuse to advertise the hosted provider on a chain it does not serve.
   *
   * We respond 200 with empty URLs plus an explicit reason (rather than an error
   * status) so existing clients take their normal "no infrastructure configured"
   * path — which means a direct wallet transaction, paid for by the user —
   * instead of surfacing an opaque provider failure mid-cancellation.
   */
  const usesHostedProvider =
    isPimlicoEndpoint(bundlerUrl) || isPimlicoEndpoint(paymasterUrl);

  if (usesHostedProvider && !HOSTED_PROVIDER_SUPPORTED_CHAIN_IDS.has(chainId)) {
    return c.json(
      {
        data: {
          provider: "pimlico" as const,
          chainId,
          bundlerUrl: "",
          paymasterUrl: "",
          selfFunded: requestedSelfFunded,
          available: false,
          reason:
            `Gas sponsorship is not available on chain ${chainId}. ` +
            "The hosted smart-account provider does not support this network, so " +
            "transactions are submitted directly by the connected wallet, which " +
            "pays its own gas.",
        },
      },
      200,
      corsHeaders(origin),
    );
  }

  const data = {
    provider: "pimlico" as const,
    chainId,
    bundlerUrl,
    paymasterUrl,
    selfFunded: requestedSelfFunded,
    available: true,
  };

  return c.json({ data }, 200, corsHeaders(origin));
}
