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

function getExplicitPimlicoOverride(chainId: number) {
  const explicitUrl =
    readTrimmedEnv(`PAYMASTER_RPC_URL_${chainId}`) ||
    readTrimmedEnv(`PIMLICO_RPC_${chainId}`) ||
    readTrimmedEnv(`NEXT_PUBLIC_PIMLICO_RPC_${chainId}`) ||
    readTrimmedEnv("PAYMASTER_RPC_URL") ||
    PIMLICO_RPC_URL ||
    "";

  if (explicitUrl.trim()) {
    return explicitUrl.trim();
  }

  const apiKey = getPimlicoApiKey(chainId);
  if (!apiKey) {
    return "";
  }

  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
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

  const pimlicoUrl = getExplicitPimlicoOverride(chainId);
  if (!pimlicoUrl) {
    return c.json(
      {
        error:
          "No smart-account provider is configured on the backend. Set Pimlico environment variables first.",
      },
      503,
      corsHeaders(origin),
    );
  }

  const data = {
    provider: "pimlico" as const,
    chainId,
    bundlerUrl: pimlicoUrl,
    paymasterUrl: pimlicoUrl,
    selfFunded: requestedSelfFunded,
  };

  return c.json({ data }, 200, corsHeaders(origin));
}
